/**
 * Durable CRM -> IMAP move/archive/trash/delete convergence queue.
 */

import { randomUUID } from "crypto";
import { pool } from "../../config/db.js";
import { rebuildThreadMetadata } from "./mailThreading.service.js";
import { deriveMailAccountCapabilities, activeSqlPredicate } from "./mailAccountState.service.js";
import {
  applyMove,
  isTemporaryMoveProviderError,
  sanitizeMoveProviderError,
} from "./mailImapMoveProvider.service.js";
import { delayMsAfterFlagMutationFailure } from "./mailFlagMutationBackoff.service.js";
import { getAccessibleAccountIdArray } from "./mailApi.service.js";

export const MailMoveMutationStatuses = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  RETRYING: "RETRYING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
};

export const MailMoveOperations = {
  MOVE: "MOVE",
  ARCHIVE: "ARCHIVE",
  TRASH: "TRASH",
  RESTORE: "RESTORE",
  JUNK: "JUNK",
  UNJUNK: "UNJUNK",
  HARD_DELETE: "HARD_DELETE",
};

const MAX_ATTEMPTS = 8;
const MAX_BULK = 100;
const DEFAULT_BATCH = Math.min(Math.max(Number(process.env.MAIL_MOVE_MUTATION_BATCH) || 8, 1), 64);
const STUCK_PROCESSING_MINUTES = Math.min(Math.max(Number(process.env.MAIL_MOVE_MUTATION_STUCK_MINUTES) || 5, 1), 120);

function queuedStatusFor(op) {
  return op === MailMoveOperations.HARD_DELETE ? "PENDING_DELETE_SYNC" : "PENDING_MOVE_SYNC";
}

function normalizeOperation(op) {
  const v = String(op || "").trim().toUpperCase().replace("-", "_");
  return Object.values(MailMoveOperations).includes(v) ? v : null;
}

function targetTypeForOperation(operation) {
  if (operation === MailMoveOperations.ARCHIVE) return "ARCHIVE";
  if (operation === MailMoveOperations.TRASH) return "TRASH";
  if (operation === MailMoveOperations.JUNK) return "JUNK";
  if (operation === MailMoveOperations.RESTORE || operation === MailMoveOperations.UNJUNK) return "INBOX";
  return null;
}

function specialUseForType(type) {
  if (type === "ARCHIVE") return "\\Archive";
  if (type === "TRASH") return "\\Trash";
  if (type === "JUNK") return "\\Junk";
  if (type === "INBOX") return "\\Inbox";
  return null;
}

async function resolveTargetFolder(client, p) {
  if (p.operation === MailMoveOperations.HARD_DELETE) return null;
  if ((p.operation === MailMoveOperations.RESTORE || p.operation === MailMoveOperations.UNJUNK) && p.message?.previous_folder_id) {
    const prev = await client.query(
      `SELECT id, external_id, name, type, special_use
       FROM mail_folders
       WHERE id = $1
         AND organization_id = $2
         AND mail_account_id = $3
         AND is_active = true
         AND selectable = true
       LIMIT 1`,
      [p.message.previous_folder_id, p.organizationId, p.mailAccountId]
    );
    const row = prev.rows[0];
    if (row) return { ok: true, folder: row, path: row.external_id || row.name, restoredPrevious: true };
  }
  if (p.operation === MailMoveOperations.MOVE) {
    if (!p.targetFolderId) return { ok: false, code: "TARGET_FOLDER_REQUIRED" };
    const r = await client.query(
      `SELECT id, external_id, name, type
       FROM mail_folders
       WHERE id = $1
         AND organization_id = $2
         AND mail_account_id = $3
         AND is_active = true
         AND selectable = true
       LIMIT 1`,
      [p.targetFolderId, p.organizationId, p.mailAccountId]
    );
    const row = r.rows[0];
    if (!row) return { ok: false, code: "TARGET_FOLDER_NOT_FOUND" };
    return { ok: true, folder: row, path: row.external_id || row.name };
  }

  const type = targetTypeForOperation(p.operation);
  if (!type) return { ok: false, code: "TARGET_FOLDER_REQUIRED" };
  const specialUse = specialUseForType(type);
  const r = await client.query(
    `SELECT id, external_id, name, type, special_use
     FROM mail_folders
     WHERE organization_id = $1
       AND mail_account_id = $2
       AND is_active = true
       AND selectable = true
       AND type = $3::mail_folder_type
     ORDER BY
       CASE WHEN special_use = $4 THEN 0 WHEN special_use IS NOT NULL THEN 1 ELSE 2 END,
       sync_priority ASC,
       depth ASC,
       lower(name) ASC`,
    [p.organizationId, p.mailAccountId, type, specialUse]
  );
  if (r.rows.length === 0) return { ok: false, code: `${type}_FOLDER_NOT_FOUND` };
  const exact = r.rows.filter((row) => row.special_use === specialUse);
  const candidates = exact.length > 0 ? exact : r.rows;
  if (candidates.length > 1 && exact.length === 0) {
    return { ok: false, code: `${type}_FOLDER_AMBIGUOUS` };
  }
  const folder = candidates[0];
  return { ok: true, folder, path: folder.external_id || folder.name };
}

async function loadMessagesForAction(client, p) {
  const accIds = await getAccessibleAccountIdArray(client, p.organizationId, p.accessibleAccountIds);
  if (accIds.length === 0) return { ok: false, code: "MAIL_ACCESS_DENIED", messages: [] };
  const params = [p.organizationId, accIds];
  let idx = 3;
  let idClause = "";
  if (p.messageIds?.length) {
    params.push(p.messageIds.slice(0, MAX_BULK));
    idClause = `AND m.id = ANY($${idx}::uuid[])`;
    idx += 1;
  } else if (p.threadIds?.length) {
    params.push(p.threadIds.slice(0, MAX_BULK));
    idClause = `AND m.mail_thread_id = ANY($${idx}::uuid[])`;
    idx += 1;
  } else if (p.threadId) {
    params.push(p.threadId);
    idClause = `AND m.mail_thread_id = $${idx}::uuid`;
    idx += 1;
  } else if (p.messageId) {
    params.push(p.messageId);
    idClause = `AND m.id = $${idx}::uuid`;
    idx += 1;
  } else {
    return { ok: false, code: "NO_MESSAGES", messages: [] };
  }
  let folderClause = "";
  if (p.folderId) {
    params.push(p.folderId);
    folderClause = `AND m.folder_id = $${idx}::uuid`;
    idx += 1;
  }
  const r = await client.query(
    `SELECT m.id, m.organization_id, m.mail_thread_id, m.mail_account_id, m.folder_id,
            m.external_uid, m.external_uid_validity, m.move_intent_version,
            m.previous_folder_id, m.previous_folder_path,
            a.is_active AS account_is_active,
            a.lifecycle_state AS account_lifecycle_state,
            a.sync_enabled AS account_sync_enabled,
            a.reconnect_required AS account_reconnect_required,
            f.external_id AS folder_external_id,
            f.name AS folder_name,
            f.type AS folder_type,
            f.uid_validity AS folder_uid_validity
     FROM mail_messages m
     INNER JOIN mail_accounts a ON a.id = m.mail_account_id AND a.organization_id = m.organization_id
     LEFT JOIN mail_folders f ON f.id = m.folder_id AND f.organization_id = m.organization_id
     WHERE m.organization_id = $1
       AND m.mail_account_id = ANY($2::uuid[])
       AND m.remote_deleted_at IS NULL
       AND m.remote_missing_at IS NULL
       ${idClause}
       ${folderClause}
     ORDER BY COALESCE(m.received_at, m.sent_at, m.external_internal_date, m.created_at) DESC NULLS LAST
     LIMIT ${MAX_BULK}
     FOR UPDATE OF m`,
    params
  );
  return { ok: true, messages: r.rows };
}

async function enqueueOne(client, p) {
  const msg = p.message;
  const accountCaps = deriveMailAccountCapabilities({
    is_active: msg.account_is_active,
    lifecycle_state: msg.account_lifecycle_state,
    sync_enabled: msg.account_sync_enabled,
    reconnect_required: msg.account_reconnect_required,
  });
  if (!accountCaps.canMutate) return { messageId: msg.id, ok: false, code: "MAIL_ACCOUNT_STATE_BLOCKED" };
  const sourcePath = msg.folder_external_id || msg.folder_name || null;
  const sourceUid = msg.external_uid != null ? Number(msg.external_uid) : null;
  if (!sourcePath || !Number.isFinite(sourceUid)) {
    return { messageId: msg.id, threadId: msg.mail_thread_id, ok: false, code: "REMOTE_IDENTITY_MISSING" };
  }
  if (p.operation === MailMoveOperations.HARD_DELETE && msg.folder_type !== "TRASH") {
    return { messageId: msg.id, threadId: msg.mail_thread_id, ok: false, code: "HARD_DELETE_REQUIRES_TRASH" };
  }
  const target = await resolveTargetFolder(client, {
    operation: p.operation,
    targetFolderId: p.targetFolderId,
    organizationId: p.organizationId,
    mailAccountId: msg.mail_account_id,
    message: msg,
  });
  if (target && !target.ok) return { messageId: msg.id, threadId: msg.mail_thread_id, ok: false, code: target.code };
  if (target?.folder?.id && target.folder.id === msg.folder_id && p.operation !== MailMoveOperations.HARD_DELETE) {
    return { messageId: msg.id, threadId: msg.mail_thread_id, ok: false, code: "ALREADY_IN_TARGET_FOLDER" };
  }

  const explicitIdempotencyKey = p.idempotencyKey
    ? `client:${p.idempotencyKey}:${msg.id}:${p.operation}:${target?.folder?.id || "delete"}`
    : null;
  if (explicitIdempotencyKey) {
    const existing = await client.query(
      `SELECT id, status
       FROM mail_move_mutations
       WHERE idempotency_key = $1
         AND organization_id = $2
         AND mail_message_id = $3
       LIMIT 1`,
      [explicitIdempotencyKey, p.organizationId, msg.id]
    );
    const row = existing.rows[0];
    if (row) {
      return {
        ok: true,
        messageId: msg.id,
        threadId: msg.mail_thread_id,
        mutationId: row.id,
        syncStatus: row.status,
        replayed: true,
      };
    }
  }

  const nextVersion = Number(msg.move_intent_version || 0) + 1;
  await client.query(
    `UPDATE mail_messages SET
       move_intent_version = $3,
       move_sync_status = $4,
       move_sync_error = NULL,
       previous_folder_id = COALESCE(previous_folder_id, folder_id),
       previous_folder_path = COALESCE(previous_folder_path, $5),
       updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [msg.id, p.organizationId, nextVersion, queuedStatusFor(p.operation), sourcePath]
  );
  await client.query(
    `UPDATE mail_move_mutations SET
       status = 'CANCELLED'::mail_move_mutation_status,
       last_error_code = 'SUPERSEDED',
       last_error_message = 'Mutation remplacee par une intention plus recente',
       updated_at = now()
     WHERE mail_message_id = $1
       AND status IN ('PENDING', 'PROCESSING', 'RETRYING')`,
    [msg.id]
  );
  const idempotencyPrefix = explicitIdempotencyKey || `move:${msg.id}:${nextVersion}`;
  const idempotencyKey = explicitIdempotencyKey || `${idempotencyPrefix}:${p.operation}:${target?.folder?.id || "delete"}`;
  const ins = await client.query(
    `INSERT INTO mail_move_mutations (
       organization_id, initiated_by, mail_account_id, mail_message_id, mail_thread_id,
       source_folder_id, source_folder_path, source_uid, source_uid_validity,
       operation, target_folder_id, target_folder_path,
       previous_folder_id, previous_folder_path, intent_version, idempotency_key,
       batch_id, status, max_attempts
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10::mail_move_operation, $11, $12,
       $13, $14, $15, $16,
       $17, 'PENDING'::mail_move_mutation_status, $18
     )
     ON CONFLICT (idempotency_key) DO UPDATE SET
       status = 'PENDING'::mail_move_mutation_status,
       next_attempt_at = now(),
       updated_at = now()
     RETURNING id, status`,
    [
      p.organizationId,
      p.initiatedBy || null,
      msg.mail_account_id,
      msg.id,
      msg.mail_thread_id,
      msg.folder_id,
      sourcePath,
      sourceUid,
      msg.external_uid_validity || msg.folder_uid_validity || null,
      p.operation,
      target?.folder?.id || null,
      target?.path || null,
      msg.folder_id,
      sourcePath,
      nextVersion,
      idempotencyKey,
      p.batchId,
      MAX_ATTEMPTS,
    ]
  );
  return {
    ok: true,
    messageId: msg.id,
    threadId: msg.mail_thread_id,
    mutationId: ins.rows[0].id,
    syncStatus: "PENDING",
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   accessibleAccountIds: Set<string>,
 *   initiatedBy?: string | null,
 *   operation: string,
 *   folderId?: string | null,
 *   targetFolderId?: string | null,
 *   threadId?: string | null,
 *   threadIds?: string[],
 *   messageId?: string | null,
 *   messageIds?: string[],
 *   confirm?: boolean,
 * }}
 */
export async function enqueueMailMoveActionInTransaction(client, p) {
  const operation = normalizeOperation(p.operation);
  if (!operation) return { ok: false, code: "INVALID_OPERATION", results: [] };
  if (operation === MailMoveOperations.HARD_DELETE && p.confirm !== true) {
    return { ok: false, code: "HARD_DELETE_CONFIRMATION_REQUIRED", results: [] };
  }
  const loaded = await loadMessagesForAction(client, {
    ...p,
    organizationId: p.organizationId,
    operation,
  });
  if (!loaded.ok) return { ok: false, code: loaded.code, results: [] };
  if (loaded.messages.length === 0) return { ok: false, code: "MESSAGE_OCCURRENCE_NOT_FOUND", results: [] };
  const batchId = randomUUID();
  const results = [];
  for (const message of loaded.messages) {
    results.push(await enqueueOne(client, { ...p, operation, message, batchId }));
  }
  const queued = results.filter((r) => r.ok).length;
  const threadIds = [...new Set(loaded.messages.map((m) => m.mail_thread_id).filter(Boolean))];
  for (const threadId of threadIds) {
    await rebuildThreadMetadata({ client, threadId });
  }
  return { ok: queued > 0, code: queued > 0 ? undefined : "NO_ACTION_QUEUED", batchId, queued, results };
}

async function claimMoveMutations(client, limit) {
  const r = await client.query(
    `WITH cte AS (
      SELECT mm.id FROM mail_move_mutations mm
      INNER JOIN mail_accounts a
        ON a.id = mm.mail_account_id
       AND a.organization_id = mm.organization_id
      WHERE mm.status IN ('PENDING', 'RETRYING')
        AND mm.next_attempt_at <= now()
        AND mm.attempt_count < mm.max_attempts
        AND ${activeSqlPredicate("a", "canMutate")}
      ORDER BY mm.next_attempt_at ASC, mm.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE mail_move_mutations m SET
      status = 'PROCESSING'::mail_move_mutation_status,
      last_attempt_at = now(),
      updated_at = now()
    FROM cte
    WHERE m.id = cte.id
    RETURNING m.*`,
    [limit]
  );
  return r.rows;
}

async function completeObsoleteIfNeeded(job) {
  const r = await pool.query(
    `SELECT move_intent_version, folder_id, mail_thread_id
     FROM mail_messages
     WHERE id = $1 AND organization_id = $2`,
    [job.mail_message_id, job.organization_id]
  );
  const msg = r.rows[0];
  if (!msg) return { obsolete: true, reason: "MESSAGE_NOT_FOUND" };
  if (Number(msg.move_intent_version) !== Number(job.intent_version)) {
    return { obsolete: true, reason: "SUPERSEDED" };
  }
  return { obsolete: false };
}

async function finalizeMoveMutationSuccess(job, result) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT move_intent_version, mail_thread_id
       FROM mail_messages
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [job.mail_message_id, job.organization_id]
    );
    const msg = current.rows[0];
    if (!msg || Number(msg.move_intent_version) !== Number(job.intent_version)) {
      await client.query(
        `UPDATE mail_move_mutations SET
           status = 'CANCELLED'::mail_move_mutation_status,
           last_error_code = 'SUPERSEDED',
           last_error_message = 'Mutation confirmee mais remplacee localement',
           updated_at = now()
         WHERE id = $1`,
        [job.id]
      );
      await client.query("COMMIT");
      return;
    }

    if (job.operation === MailMoveOperations.HARD_DELETE) {
      await client.query(
        `UPDATE mail_messages SET
           remote_deleted_at = now(),
           move_sync_status = 'SYNCED',
           move_sync_error = NULL,
           move_synced_at = now(),
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [job.mail_message_id, job.organization_id]
      );
    } else if (result.requiresReconciliation) {
      await client.query(
        `UPDATE mail_messages SET
           move_sync_status = 'RECONCILIATION_REQUIRED',
           move_sync_error = 'Le serveur IMAP n''a pas fourni le nouvel UID; prochaine synchronisation requise',
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [job.mail_message_id, job.organization_id]
      );
    } else {
      await client.query(
        `UPDATE mail_messages SET
           previous_folder_id = $3,
           previous_folder_path = $4,
           folder_id = $5,
           external_uid = $6,
           external_uid_validity = COALESCE($7, external_uid_validity),
           remote_missing_at = NULL,
           remote_deleted_at = NULL,
           move_sync_status = 'SYNCED',
           move_sync_error = NULL,
           move_synced_at = now(),
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [
          job.mail_message_id,
          job.organization_id,
          job.source_folder_id,
          job.source_folder_path,
          job.target_folder_id,
          result.resultUid,
          result.resultUidValidity,
        ]
      );
    }

    await client.query(
      `UPDATE mail_move_mutations SET
         status = $2::mail_move_mutation_status,
         result_uid = $3,
         result_uid_validity = $4,
         succeeded_at = CASE WHEN $2 = 'SUCCEEDED' THEN now() ELSE succeeded_at END,
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = now()
       WHERE id = $1`,
      [
        job.id,
        result.requiresReconciliation ? MailMoveMutationStatuses.RECONCILIATION_REQUIRED : MailMoveMutationStatuses.SUCCEEDED,
        result.resultUid,
        result.resultUidValidity,
      ]
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

async function finalizeMoveMutationFailure(job, err) {
  const sanitized = sanitizeMoveProviderError(err);
  const temporary = isTemporaryMoveProviderError(err);
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
      `UPDATE mail_move_mutations SET
         status = $2::mail_move_mutation_status,
         attempt_count = $3,
         next_attempt_at = $4,
         last_error_code = $5,
         last_error_message = $6,
         updated_at = now()
       WHERE id = $1`,
      [job.id, status, attempt, nextAt, sanitized.code, sanitized.message]
    );
    const current = await client.query(
      `SELECT move_intent_version, mail_thread_id
       FROM mail_messages
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [job.mail_message_id, job.organization_id]
    );
    const msg = current.rows[0];
    if (msg && Number(msg.move_intent_version) === Number(job.intent_version)) {
      await client.query(
        `UPDATE mail_messages SET
           move_sync_status = $3,
           move_sync_error = $4,
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

async function processMoveMutationJob(job) {
  const obsolete = await completeObsoleteIfNeeded(job);
  if (obsolete.obsolete) {
    await pool.query(
      `UPDATE mail_move_mutations SET
         status = 'CANCELLED'::mail_move_mutation_status,
         last_error_code = $2,
         last_error_message = 'Mutation ignoree car une intention plus recente existe',
         updated_at = now()
       WHERE id = $1`,
      [job.id, obsolete.reason]
    );
    return { status: "cancelled" };
  }
  const result = await applyMove(pool, {
    organizationId: String(job.organization_id),
    mailAccountId: String(job.mail_account_id),
    sourcePath: String(job.source_folder_path),
    sourceUid: Number(job.source_uid),
    expectedUidValidity: job.source_uid_validity ? String(job.source_uid_validity) : null,
    targetPath: job.target_folder_path ? String(job.target_folder_path) : null,
    hardDelete: job.operation === MailMoveOperations.HARD_DELETE,
    sourceIsTrash: job.operation === MailMoveOperations.HARD_DELETE,
  });
  await finalizeMoveMutationSuccess(job, result);
  return { status: result.requiresReconciliation ? "reconciliation_required" : "succeeded" };
}

export async function reapStuckMoveMutations(maxMinutes = STUCK_PROCESSING_MINUTES) {
  const r = await pool.query(
    `UPDATE mail_move_mutations SET
       status = CASE WHEN attempt_count + 1 >= max_attempts
                     THEN 'FAILED'::mail_move_mutation_status
                     ELSE 'RETRYING'::mail_move_mutation_status END,
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

export async function processMailMoveMutationBatch(opts = {}) {
  const limit = opts.limit ?? DEFAULT_BATCH;
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimMoveMutations(client, limit);
    if (jobs.length === 0) {
      await client.query("ROLLBACK");
      return { processed: 0, succeeded: 0, failed: 0, cancelled: 0, reconciliationRequired: 0 };
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

  const out = { processed: jobs.length, succeeded: 0, failed: 0, cancelled: 0, reconciliationRequired: 0 };
  for (const job of jobs) {
    try {
      const r = await processMoveMutationJob(job);
      if (r.status === "cancelled") out.cancelled += 1;
      else if (r.status === "reconciliation_required") out.reconciliationRequired += 1;
      else out.succeeded += 1;
    } catch (err) {
      await finalizeMoveMutationFailure(job, err);
      out.failed += 1;
    }
  }
  return out;
}

export const __test = {
  normalizeOperation,
  targetTypeForOperation,
  specialUseForType,
  resolveTargetFolder,
  loadMessagesForAction,
  enqueueOne,
};
