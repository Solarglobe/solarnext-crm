/**
 * Durable CRM -> IMAP read/unread convergence queue.
 */

import { pool } from "../../config/db.js";
import { rebuildThreadMetadata } from "./mailThreading.service.js";
import { delayMsAfterFlagMutationFailure } from "./mailFlagMutationBackoff.service.js";
import {
  applyReadState,
  isTemporaryFlagProviderError,
  sanitizeFlagProviderError,
} from "./mailImapFlagsProvider.service.js";
import { deriveMailAccountCapabilities, activeSqlPredicate } from "./mailAccountState.service.js";

export const MailFlagMutationStatuses = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

const MAX_ATTEMPTS = 8;
const DEFAULT_BATCH = Math.min(Math.max(Number(process.env.MAIL_FLAG_MUTATION_BATCH) || 12, 1), 64);
const STUCK_PROCESSING_MINUTES = Math.min(Math.max(Number(process.env.MAIL_FLAG_MUTATION_STUCK_MINUTES) || 5, 1), 120);

/**
 * @param {boolean} desiredIsRead
 */
function statusForQueuedRead(desiredIsRead) {
  return desiredIsRead ? "PENDING_READ_SYNC" : "PENDING_UNREAD_SYNC";
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ messageId: string, organizationId: string, accessibleAccountIds: string[], desiredIsRead: boolean }}
 */
async function loadMessageForReadMutation(client, p) {
  const r = await client.query(
    `SELECT m.id, m.organization_id, m.mail_thread_id, m.mail_account_id, m.folder_id,
            m.external_uid, m.external_uid_validity, m.read_intent_version,
            a.is_active AS account_is_active,
            a.lifecycle_state AS account_lifecycle_state,
            a.sync_enabled AS account_sync_enabled,
            a.reconnect_required AS account_reconnect_required,
            f.external_id AS folder_external_id,
            f.name AS folder_name,
            f.uid_validity AS folder_uid_validity
     FROM mail_messages m
     INNER JOIN mail_accounts a ON a.id = m.mail_account_id AND a.organization_id = m.organization_id
     LEFT JOIN mail_folders f ON f.id = m.folder_id AND f.organization_id = m.organization_id
     WHERE m.id = $1
       AND m.organization_id = $2
       AND m.mail_account_id = ANY($3::uuid[])
     FOR UPDATE OF m`,
    [p.messageId, p.organizationId, p.accessibleAccountIds]
  );
  return r.rows[0] ?? null;
}

/**
 * Enregistre l'intention locale et cree une mutation distante durable si le
 * message possede une cle distante exploitable. Les anciennes intentions non
 * terminees sont annulees dans la meme transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   messageId: string,
 *   desiredIsRead: boolean,
 *   accessibleAccountIds: string[],
 * }}
 */
export async function enqueueReadFlagMutationInTransaction(client, p) {
  const msg = await loadMessageForReadMutation(client, p);
  if (!msg) return { ok: false, code: "MESSAGE_NOT_FOUND" };
  const accountCaps = deriveMailAccountCapabilities({
    is_active: msg.account_is_active,
    lifecycle_state: msg.account_lifecycle_state,
    sync_enabled: msg.account_sync_enabled,
    reconnect_required: msg.account_reconnect_required,
  });
  if (!accountCaps.canMutate) return { ok: false, code: "MAIL_ACCOUNT_STATE_BLOCKED" };

  const nextVersion = Number(msg.read_intent_version || 0) + 1;
  const folderPath = msg.folder_external_id || msg.folder_name || null;
  const uid = msg.external_uid != null ? Number(msg.external_uid) : null;
  const uidValidity = msg.external_uid_validity || msg.folder_uid_validity || null;

  await client.query(
    `UPDATE mail_messages SET
       is_read = $3,
       read_intent_version = $4,
       read_sync_status = $5,
       read_sync_error = NULL,
       updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [p.messageId, p.organizationId, p.desiredIsRead, nextVersion, statusForQueuedRead(p.desiredIsRead)]
  );
  await rebuildThreadMetadata({ client, threadId: msg.mail_thread_id });

  await client.query(
    `UPDATE mail_flag_mutations SET
       status = 'CANCELLED'::mail_flag_mutation_status,
       last_error_code = 'SUPERSEDED',
       last_error_message = 'Mutation remplacee par une intention plus recente',
       updated_at = now()
     WHERE mail_message_id = $1
       AND operation = 'SET_READ'::mail_flag_mutation_operation
       AND status IN ('PENDING', 'PROCESSING', 'RETRYING')`,
    [p.messageId]
  );

  if (!folderPath || !Number.isFinite(uid)) {
    await client.query(
      `UPDATE mail_messages SET
         read_sync_status = 'LOCAL_ONLY',
         read_sync_error = 'Message sans UID ou dossier distant exploitable',
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [p.messageId, p.organizationId]
    );
    return {
      ok: true,
      messageId: p.messageId,
      threadId: msg.mail_thread_id,
      desiredIsRead: p.desiredIsRead,
      syncStatus: "LOCAL_ONLY",
      mutationId: null,
    };
  }

  const idempotencyKey = `read:${p.messageId}:${nextVersion}:${p.desiredIsRead ? "1" : "0"}`;
  const ins = await client.query(
    `INSERT INTO mail_flag_mutations (
       organization_id, mail_account_id, mail_message_id, mail_thread_id,
       folder_id, folder_path, external_uid, external_uid_validity,
       operation, desired_is_read, intent_version, idempotency_key,
       status, max_attempts
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       'SET_READ'::mail_flag_mutation_operation, $9, $10, $11,
       'PENDING'::mail_flag_mutation_status, $12
     )
     ON CONFLICT (idempotency_key) DO UPDATE SET
       desired_is_read = EXCLUDED.desired_is_read,
       status = 'PENDING'::mail_flag_mutation_status,
       next_attempt_at = now(),
       updated_at = now()
     RETURNING id, status`,
    [
      p.organizationId,
      msg.mail_account_id,
      p.messageId,
      msg.mail_thread_id,
      msg.folder_id,
      folderPath,
      uid,
      uidValidity,
      p.desiredIsRead,
      nextVersion,
      idempotencyKey,
      MAX_ATTEMPTS,
    ]
  );

  return {
    ok: true,
    messageId: p.messageId,
    threadId: msg.mail_thread_id,
    desiredIsRead: p.desiredIsRead,
    syncStatus: "PENDING",
    mutationId: ins.rows[0].id,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} limit
 */
async function claimFlagMutations(client, limit) {
  const r = await client.query(
    `WITH cte AS (
      SELECT fm.id FROM mail_flag_mutations fm
      INNER JOIN mail_accounts a
        ON a.id = fm.mail_account_id
       AND a.organization_id = fm.organization_id
      WHERE fm.status IN ('PENDING', 'RETRYING')
        AND fm.next_attempt_at <= now()
        AND fm.attempt_count < fm.max_attempts
        AND ${activeSqlPredicate("a", "canMutate")}
        AND NOT EXISTS (
          SELECT 1 FROM mail_move_mutations mv
          WHERE mv.mail_message_id = fm.mail_message_id
            AND mv.status IN ('PENDING', 'PROCESSING', 'RETRYING')
        )
      ORDER BY fm.next_attempt_at ASC, fm.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE mail_flag_mutations m SET
      status = 'PROCESSING'::mail_flag_mutation_status,
      last_attempt_at = now(),
      updated_at = now()
    FROM cte
    WHERE m.id = cte.id
    RETURNING m.*`,
    [limit]
  );
  return r.rows;
}

/**
 * @param {Record<string, unknown>} job
 */
async function completeObsoleteIfNeeded(job) {
  const r = await pool.query(
    `SELECT read_intent_version, is_read, mail_thread_id
     FROM mail_messages
     WHERE id = $1 AND organization_id = $2`,
    [job.mail_message_id, job.organization_id]
  );
  const msg = r.rows[0];
  if (!msg) return { obsolete: true, reason: "MESSAGE_NOT_FOUND" };
  if (Number(msg.read_intent_version) !== Number(job.intent_version)) {
    return { obsolete: true, reason: "SUPERSEDED" };
  }
  if (msg.is_read !== job.desired_is_read) {
    return { obsolete: true, reason: "LOCAL_STATE_CHANGED" };
  }
  return { obsolete: false };
}

/**
 * @param {Record<string, unknown>} job
 * @param {{ mailbox: { uidValidity: string | null, highestModseq: string | null }, confirmed: { isRead: boolean, flags: string[], modseq: string | null } }} result
 */
async function finalizeFlagMutationSuccess(job, result) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query(
      `SELECT read_intent_version, mail_thread_id
       FROM mail_messages
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [job.mail_message_id, job.organization_id]
    );
    const msg = current.rows[0];
    if (!msg || Number(msg.read_intent_version) !== Number(job.intent_version)) {
      await client.query(
        `UPDATE mail_flag_mutations SET
           status = 'CANCELLED'::mail_flag_mutation_status,
           last_error_code = 'SUPERSEDED',
           last_error_message = 'Mutation confirmee mais remplacee localement',
           updated_at = now()
         WHERE id = $1`,
        [job.id]
      );
      await client.query("COMMIT");
      return;
    }

    await client.query(
      `UPDATE mail_messages SET
         is_read = $3,
         external_flags = $4::jsonb,
         external_uid_validity = COALESCE($5, external_uid_validity),
         external_modseq = COALESCE($6, external_modseq),
         read_sync_status = 'SYNCED',
         read_sync_error = NULL,
         read_synced_at = now(),
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [
        job.mail_message_id,
        job.organization_id,
        job.desired_is_read,
        JSON.stringify(result.confirmed.flags),
        result.mailbox.uidValidity,
        result.confirmed.modseq,
      ]
    );
    if (job.folder_id) {
      await client.query(
        `UPDATE mail_folders SET
           uid_validity = COALESCE($2, uid_validity),
           highest_modseq = COALESCE($3, highest_modseq),
           last_flag_sync_at = now(),
           flag_sync_error_code = NULL,
           flag_sync_error_message = NULL,
           flag_sync_error_at = NULL,
           updated_at = now()
         WHERE id = $1 AND organization_id = $4`,
        [job.folder_id, result.mailbox.uidValidity, result.mailbox.highestModseq, job.organization_id]
      );
    }
    await client.query(
      `UPDATE mail_flag_mutations SET
         status = 'SUCCEEDED'::mail_flag_mutation_status,
         succeeded_at = now(),
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = now()
       WHERE id = $1`,
      [job.id]
    );
    await rebuildThreadMetadata({ client, threadId: msg.mail_thread_id });
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {Record<string, unknown>} job
 * @param {unknown} err
 */
async function finalizeFlagMutationFailure(job, err) {
  const sanitized = sanitizeFlagProviderError(err);
  const temporary = isTemporaryFlagProviderError(err);
  const prev = Number(job.attempt_count) || 0;
  const attempt = prev + 1;
  const maxAttempts = Number(job.max_attempts) || MAX_ATTEMPTS;
  const permanent = !temporary || attempt >= maxAttempts;
  const status = permanent ? "FAILED" : "RETRYING";
  const delayMs = permanent ? 0 : delayMsAfterFlagMutationFailure(attempt);
  const nextAt = new Date(Date.now() + delayMs);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE mail_flag_mutations SET
         status = $2::mail_flag_mutation_status,
         attempt_count = $3,
         next_attempt_at = $4,
         last_error_code = $5,
         last_error_message = $6,
         updated_at = now()
       WHERE id = $1`,
      [job.id, status, attempt, nextAt, sanitized.code, sanitized.message]
    );

    const current = await client.query(
      `SELECT read_intent_version, mail_thread_id
       FROM mail_messages
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [job.mail_message_id, job.organization_id]
    );
    const msg = current.rows[0];
    if (msg && Number(msg.read_intent_version) === Number(job.intent_version)) {
      await client.query(
        `UPDATE mail_messages SET
           read_sync_status = $3,
           read_sync_error = $4,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [job.mail_message_id, job.organization_id, status, sanitized.message]
      );
      await rebuildThreadMetadata({ client, threadId: msg.mail_thread_id });
    }

    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {Record<string, unknown>} job
 */
async function processFlagMutationJob(job) {
  const obsolete = await completeObsoleteIfNeeded(job);
  if (obsolete.obsolete) {
    await pool.query(
      `UPDATE mail_flag_mutations SET
         status = 'CANCELLED'::mail_flag_mutation_status,
         last_error_code = $2,
         last_error_message = $3,
         updated_at = now()
       WHERE id = $1`,
      [job.id, obsolete.reason, "Mutation ignoree car une intention plus recente existe"]
    );
    return { status: "cancelled" };
  }

  const result = await applyReadState(pool, {
    organizationId: String(job.organization_id),
    mailAccountId: String(job.mail_account_id),
    folderPath: String(job.folder_path),
    uid: Number(job.external_uid),
    desiredIsRead: job.desired_is_read === true,
    expectedUidValidity: job.external_uid_validity ? String(job.external_uid_validity) : null,
  });
  await finalizeFlagMutationSuccess(job, result);
  return { status: "succeeded" };
}

/**
 * Requeues mutations left in PROCESSING by a crash/restart.
 * @param {number} [maxMinutes]
 */
export async function reapStuckFlagMutations(maxMinutes = STUCK_PROCESSING_MINUTES) {
  const r = await pool.query(
    `UPDATE mail_flag_mutations SET
       status = CASE WHEN attempt_count + 1 >= max_attempts
                     THEN 'FAILED'::mail_flag_mutation_status
                     ELSE 'RETRYING'::mail_flag_mutation_status END,
       attempt_count = attempt_count + 1,
       last_error_code = 'WORKER_INTERRUPTED',
       last_error_message = 'Mutation interrompue pendant le traitement',
       next_attempt_at = now(),
       updated_at = now()
     WHERE status = 'PROCESSING'
       AND last_attempt_at < now() - ($1 * interval '1 minute')
     RETURNING id`,
    [maxMinutes]
  );
  return { reaped: r.rows.length };
}

/**
 * @param {{ limit?: number }} [opts]
 */
export async function processMailFlagMutationBatch(opts = {}) {
  const limit = opts.limit ?? DEFAULT_BATCH;
  const client = await pool.connect();
  /** @type {Record<string, unknown>[]} */
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimFlagMutations(client, limit);
    if (jobs.length === 0) {
      await client.query("ROLLBACK");
      return { processed: 0, succeeded: 0, failed: 0, cancelled: 0 };
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }

  const out = { processed: jobs.length, succeeded: 0, failed: 0, cancelled: 0 };
  for (const job of jobs) {
    try {
      const r = await processFlagMutationJob(job);
      if (r.status === "cancelled") out.cancelled += 1;
      else out.succeeded += 1;
    } catch (err) {
      await finalizeFlagMutationFailure(job, err);
      out.failed += 1;
    }
  }
  return out;
}

/**
 * Applies remote observations when no newer local read intent is pending.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   folderId: string,
 *   uid: number,
 *   uidValidity: string | null,
 *   modseq: string | null,
 *   flags: string[],
 *   isRead: boolean,
 * }}
 */
export async function applyRemoteReadObservationInTransaction(client, p) {
  const pending = await client.query(
    `SELECT 1 FROM mail_flag_mutations
     WHERE organization_id = $1
       AND mail_account_id = $2
       AND folder_id = $3
       AND external_uid = $4
       AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
     LIMIT 1`,
    [p.organizationId, p.mailAccountId, p.folderId, p.uid]
  );
  if (pending.rows.length > 0) return { applied: false, reason: "LOCAL_INTENT_PENDING" };

  const r = await client.query(
    `UPDATE mail_messages SET
       is_read = $6,
       external_flags = $7::jsonb,
       external_uid_validity = COALESCE($8, external_uid_validity),
       external_modseq = COALESCE($9, external_modseq),
       read_sync_status = 'SYNCED',
       read_sync_error = NULL,
       read_synced_at = now(),
       updated_at = now()
     WHERE organization_id = $1
       AND mail_account_id = $2
       AND folder_id = $3
       AND external_uid = $4
       AND (external_uid_validity IS NULL OR $5::text IS NULL OR external_uid_validity = $5::text)
       AND (
         is_read IS DISTINCT FROM $6
         OR external_flags IS DISTINCT FROM $7::jsonb
         OR external_modseq IS DISTINCT FROM $9::text
       )
     RETURNING mail_thread_id`,
    [
      p.organizationId,
      p.mailAccountId,
      p.folderId,
      p.uid,
      p.uidValidity,
      p.isRead,
      JSON.stringify(p.flags),
      p.uidValidity,
      p.modseq,
    ]
  );
  for (const row of r.rows) {
    await rebuildThreadMetadata({ client, threadId: row.mail_thread_id });
  }
  return { applied: r.rowCount > 0, updatedThreads: r.rows.length };
}
