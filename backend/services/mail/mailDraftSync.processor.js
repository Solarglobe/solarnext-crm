import { pool } from "../../config/db.js";
import logger from "../../app/core/logger.js";
import { delayMsAfterFailedAttempt } from "./mailOutboxBackoff.service.js";
import { appendDraftWithClient, deleteDraftWithClient, withDraftImapClient } from "./mailImapDraftProvider.service.js";
import { buildSimpleRfc822Mime } from "./mailMimeBuilder.service.js";
import { assertMailAccountCapability } from "./mailAccountState.service.js";
import { loadDraftAttachmentBuffers } from "./mailDraftAttachments.service.js";

const BATCH = Math.min(Math.max(Number(process.env.MAIL_DRAFT_SYNC_BATCH) || 6, 1), 24);
const STUCK_MINUTES = Math.min(Math.max(Number(process.env.MAIL_DRAFT_SYNC_STUCK_MINUTES) || 10, 2), 120);

async function claimDraftJobs(client, limit) {
  const r = await client.query(
    `WITH cte AS (
       SELECT j.id
         FROM mail_draft_sync_jobs j
         JOIN mail_accounts a ON a.id = j.mail_account_id AND a.organization_id = j.organization_id
        WHERE j.status IN ('queued', 'retrying')
          AND j.next_attempt_at <= now()
          AND j.attempt_count < j.max_attempts
          AND a.is_active = true
          AND a.lifecycle_state IN ('CONNECTED', 'DEGRADED')
          AND a.sync_enabled = true
          AND a.reconnect_required = false
        ORDER BY j.next_attempt_at ASC, j.updated_at DESC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE mail_draft_sync_jobs j SET
       status = 'running',
       locked_at = now(),
       updated_at = now()
     FROM cte
     WHERE j.id = cte.id
     RETURNING j.*`,
    [limit]
  );
  return r.rows;
}

async function loadDraftContext(client, job) {
  const r = await client.query(
    `SELECT d.*, a.email AS account_email, a.display_name AS account_display_name,
            a.is_active, a.lifecycle_state, a.sync_enabled, a.reconnect_required,
            f.id AS draft_folder_id, f.external_id AS draft_folder_path, f.name AS draft_folder_name
       FROM mail_drafts d
       JOIN mail_accounts a ON a.id = d.mail_account_id AND a.organization_id = d.organization_id
       LEFT JOIN mail_folders f ON f.mail_account_id = d.mail_account_id
        AND f.organization_id = d.organization_id
        AND f.type = 'DRAFT'
        AND f.is_active = true
      WHERE d.id = $1 AND d.organization_id = $2 AND d.mail_account_id = $3
      FOR UPDATE OF d`,
    [job.draft_id, job.organization_id, job.mail_account_id]
  );
  const row = r.rows[0];
  if (!row) throw new Error("Brouillon introuvable");
  assertMailAccountCapability(row, "canMutate");
  return row;
}

function draftFolderPath(draft) {
  return draft.draft_folder_path || draft.draft_folder_name || "Drafts";
}

async function mimeForDraft(draft) {
  const attachments = await loadDraftAttachmentBuffers({
    organizationId: draft.organization_id,
    draftId: draft.id,
    expectedUserId: draft.user_id,
  });
  return buildSimpleRfc822Mime({
    messageId: draft.message_id,
    draftIdentity: draft.draft_identity,
    from: draft.account_display_name ? `"${String(draft.account_display_name).replace(/"/g, "")}" <${draft.account_email}>` : draft.account_email,
    to: draft.to_recipients,
    cc: draft.cc_recipients,
    bcc: draft.bcc_recipients,
    subject: draft.subject,
    bodyText: draft.body_text,
    bodyHtml: draft.body_html,
    attachments,
  });
}

async function completeJob(client, jobId) {
  await client.query(
    `UPDATE mail_draft_sync_jobs SET status = 'succeeded', completed_at = now(), last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [jobId]
  );
}

async function failJob(job, err) {
  const prev = Number(job.attempt_count) || 0;
  const nextAttempts = prev + 1;
  const max = Number(job.max_attempts) || 8;
  const permanent = nextAttempts >= max;
  const delayMs = delayMsAfterFailedAttempt(nextAttempts);
  const msg = err instanceof Error ? err.message : String(err);
  await pool.query(
    `UPDATE mail_draft_sync_jobs SET
       status = $2,
       attempt_count = $3,
       next_attempt_at = $4,
       last_error = $5,
       updated_at = now()
     WHERE id = $1`,
    [job.id, permanent ? "failed" : "retrying", nextAttempts, new Date(Date.now() + delayMs), msg.slice(0, 4000)]
  );
  if (job.draft_id) {
    await pool.query(
      `UPDATE mail_drafts SET sync_status = $4, sync_error = $5, updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3`,
      [job.draft_id, job.organization_id, job.mail_account_id, permanent ? "ERROR" : "OFFLINE", msg.slice(0, 1000)]
    );
  }
}

async function processUpsert(job) {
  const lock = await pool.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS locked`, [`mail-draft:${job.draft_id}`]);
  if (lock.rows[0]?.locked !== true) return { skipped: true, reason: "draft_locked" };
  try {
    const draft = await pool.connect();
    let row;
    try {
      await draft.query("BEGIN");
      row = await loadDraftContext(draft, job);
      await draft.query(`UPDATE mail_drafts SET sync_status = 'SYNCING', sync_error = NULL WHERE id = $1`, [job.draft_id]);
      await draft.query("COMMIT");
    } catch (e) {
      await draft.query("ROLLBACK");
      throw e;
    } finally {
      draft.release();
    }

    const oldUid = row.remote_uid == null ? null : Number(row.remote_uid);
    const folderPath = draftFolderPath(row);
    const mime = await mimeForDraft(row);
    const appended = await withDraftImapClient(pool, {
      organizationId: String(job.organization_id),
      mailAccountId: String(job.mail_account_id),
    }, (imap) => appendDraftWithClient(imap, {
      folderPath,
      mime,
      draftIdentity: row.draft_identity,
      internalDate: new Date(),
    }));

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `UPDATE mail_drafts SET
           remote_folder_id = COALESCE($4, remote_folder_id),
           remote_uid = $5,
           remote_uid_validity = $6,
           remote_modseq = $7,
           remote_version = $8,
           sync_status = CASE WHEN $9::boolean THEN 'QUEUED' ELSE 'SYNCED' END,
           local_dirty = $9::boolean,
           last_remote_saved_at = CASE WHEN $9::boolean THEN last_remote_saved_at ELSE now() END,
           sync_error = CASE WHEN $9::boolean THEN 'Identite distante a reconcilier apres append' ELSE NULL END,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3`,
        [
          job.draft_id,
          job.organization_id,
          job.mail_account_id,
          row.draft_folder_id,
          appended.uid,
          appended.uidValidity,
          appended.highestModseq,
          `${appended.uidValidity || ""}:${appended.uid || ""}:${appended.highestModseq || ""}`,
          appended.requiresReconciliation,
        ]
      );
      await completeJob(db, job.id);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }

    if (oldUid && appended.uid && Number(oldUid) !== Number(appended.uid)) {
      try {
        await withDraftImapClient(pool, {
          organizationId: String(job.organization_id),
          mailAccountId: String(job.mail_account_id),
        }, (imap) => deleteDraftWithClient(imap, { folderPath, uid: oldUid }));
      } catch (e) {
        await pool.query(
          `INSERT INTO mail_draft_sync_jobs
             (organization_id, mail_account_id, draft_id, action, status, idempotency_key, payload_json, next_attempt_at)
           VALUES ($1, $2, $3, 'cleanup_old_version', 'queued', $4, $5::jsonb, now())
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
          [
            job.organization_id,
            job.mail_account_id,
            job.draft_id,
            `draft-cleanup:${job.draft_id}:${oldUid}`,
            JSON.stringify({ oldUid, folderPath }),
          ]
        );
        logger.warn({ evt: "MAIL_DRAFT_OLD_DELETE_DEFERRED", draftId: job.draft_id, oldUid }, e instanceof Error ? e.message : String(e));
      }
    }
    return { ok: true };
  } finally {
    await pool.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`mail-draft:${job.draft_id}`]).catch(() => {});
  }
}

async function processDelete(job) {
  const db = await pool.connect();
  let row;
  try {
    await db.query("BEGIN");
    row = await loadDraftContext(db, job);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  const uid = row.remote_uid == null ? null : Number(row.remote_uid);
  if (uid) {
    await withDraftImapClient(pool, {
      organizationId: String(job.organization_id),
      mailAccountId: String(job.mail_account_id),
    }, (imap) => deleteDraftWithClient(imap, { folderPath: draftFolderPath(row), uid }));
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM mail_drafts WHERE id = $1 AND organization_id = $2`, [job.draft_id, job.organization_id]);
    await completeJob(client, job.id);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { ok: true };
}

async function processCleanup(job) {
  const payload = typeof job.payload_json === "object" && job.payload_json ? job.payload_json : {};
  const uid = Number(payload.oldUid);
  if (Number.isFinite(uid) && payload.folderPath) {
    await withDraftImapClient(pool, {
      organizationId: String(job.organization_id),
      mailAccountId: String(job.mail_account_id),
    }, (imap) => deleteDraftWithClient(imap, { folderPath: String(payload.folderPath), uid }));
  }
  await pool.query(`UPDATE mail_draft_sync_jobs SET status = 'succeeded', completed_at = now(), updated_at = now() WHERE id = $1`, [job.id]);
  return { ok: true };
}

export async function processMailDraftSyncBatch() {
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimDraftJobs(client, BATCH);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  for (const job of jobs) {
    try {
      const action = String(job.action || "").toLowerCase();
      if (action === "save" || action === "upsert") await processUpsert(job);
      else if (action === "delete") await processDelete(job);
      else if (action === "cleanup_old_version") await processCleanup(job);
      else throw new Error(`Action draft inconnue: ${job.action}`);
    } catch (e) {
      await failJob(job, e);
    }
  }
  return { processed: jobs.length };
}

export async function reapStuckDraftSyncJobs(maxMinutes = STUCK_MINUTES) {
  const r = await pool.query(
    `UPDATE mail_draft_sync_jobs SET
       status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE 'retrying' END,
       attempt_count = attempt_count + 1,
       next_attempt_at = now(),
       last_error = 'Job brouillon bloque repris automatiquement',
       updated_at = now()
     WHERE status = 'running'
       AND locked_at < now() - ($1 * interval '1 minute')
     RETURNING id`,
    [maxMinutes]
  );
  return { reaped: r.rowCount };
}
