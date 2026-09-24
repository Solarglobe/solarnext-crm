import { pool } from "../../config/db.js";
import logger from "../../app/core/logger.js";
import { delayMsAfterFailedAttempt } from "./mailOutboxBackoff.service.js";
import { appendDraftWithClient, deleteDraftWithClient, withDraftImapClient } from "./mailImapDraftProvider.service.js";
import { buildSimpleRfc822Mime } from "./mailMimeBuilder.service.js";
import { loadDraftAttachmentBuffers } from "./mailDraftAttachments.service.js";
import { assertDraftMailAccountAccess } from "./mailDraftAccess.service.js";
import { draftFenceError, hasDraftJobFence, lockDraftTransaction, matchesDraftJobFence } from "./mailDraftFence.service.js";

const BATCH = Math.min(Math.max(Number(process.env.MAIL_DRAFT_SYNC_BATCH) || 6, 1), 24);
const STUCK_MINUTES = Math.min(Math.max(Number(process.env.MAIL_DRAFT_SYNC_STUCK_MINUTES) || 10, 2), 120);

async function claimDraftJobs(client, limit) {
  const result = await client.query(
    `WITH cte AS (
       SELECT j.id FROM mail_draft_sync_jobs j
       JOIN mail_accounts a ON a.id = j.mail_account_id AND a.organization_id = j.organization_id
       WHERE j.status IN ('queued', 'retrying') AND j.next_attempt_at <= now()
         AND j.attempt_count < j.max_attempts AND a.is_active = true
         AND a.lifecycle_state IN ('CONNECTED', 'DEGRADED') AND a.sync_enabled = true AND a.reconnect_required = false
       ORDER BY j.next_attempt_at ASC, j.updated_at DESC FOR UPDATE SKIP LOCKED LIMIT $1
     ) UPDATE mail_draft_sync_jobs j SET status = 'running', locked_at = now(), updated_at = now()
       FROM cte WHERE j.id = cte.id RETURNING j.*`, [limit]);
  return result.rows;
}

async function loadDraftContext(client, job) {
  const result = await client.query(
    `SELECT d.*, a.email AS account_email, a.display_name AS account_display_name,
            f.id AS draft_folder_id, f.external_id AS draft_folder_path, f.name AS draft_folder_name,
            rf.mail_account_id AS remote_folder_account_id, rf.external_id AS remote_folder_path,
            rf.name AS remote_folder_name
       FROM mail_drafts d
       JOIN mail_accounts a ON a.id = d.mail_account_id AND a.organization_id = d.organization_id
       LEFT JOIN mail_folders f ON f.mail_account_id = d.mail_account_id AND f.organization_id = d.organization_id
         AND f.type = 'DRAFT' AND f.is_active = true
       LEFT JOIN mail_folders rf ON rf.id = d.remote_folder_id AND rf.organization_id = d.organization_id
      WHERE d.id = $1 AND d.organization_id = $2 AND d.mail_account_id = $3 FOR UPDATE OF d`,
    [job.draft_id, job.organization_id, job.mail_account_id]);
  return result.rows[0] || null;
}

async function authorize(client, row, job) {
  return assertDraftMailAccountAccess(client, {
    organizationId: job.organization_id, userId: row.user_id, mailAccountId: job.mail_account_id,
  }, { forSync: true });
}

function currentRemote(row, job) {
  const remote = job.payload_json.remote;
  if (row.remote_uid == null) {
    if (remote.uid != null) throw draftFenceError("DRAFT_REFERENCE_CHANGED", "La référence distante du brouillon a changé.");
    return null;
  }
  if (Number(remote.uid) !== Number(row.remote_uid) || String(remote.uidValidity ?? "") !== String(row.remote_uid_validity ?? "") ||
      String(remote.folderId ?? "") !== String(row.remote_folder_id ?? "") ||
      !row.remote_folder_id || row.remote_folder_account_id !== job.mail_account_id ||
      !(row.remote_folder_path || row.remote_folder_name)) {
    throw draftFenceError("DRAFT_REFERENCE_CHANGED", "La référence distante n’appartient plus à cette version du brouillon.");
  }
  return { ...remote, folderPath: row.remote_folder_path || row.remote_folder_name };
}

async function mimeForDraft(draft) {
  const attachments = await loadDraftAttachmentBuffers({ organizationId: draft.organization_id, draftId: draft.id, expectedUserId: draft.user_id });
  return buildSimpleRfc822Mime({
    messageId: draft.message_id, draftIdentity: draft.draft_identity,
    from: draft.account_display_name ? `"${String(draft.account_display_name).replace(/"/g, "")}" <${draft.account_email}>` : draft.account_email,
    to: draft.to_recipients, cc: draft.cc_recipients, bcc: draft.bcc_recipients,
    subject: draft.subject, bodyText: draft.body_text, bodyHtml: draft.body_html, attachments,
  });
}

async function deleteRemote(client, row, job, reference) {
  if (!reference || reference.accountId !== job.mail_account_id) {
    throw draftFenceError("DRAFT_REFERENCE_CHANGED", "Boîte distante non vérifiable pour cette suppression.");
  }
  await authorize(client, row, job);
  return withDraftImapClient(client, { organizationId: job.organization_id, mailAccountId: reference.accountId },
    imap => deleteDraftWithClient(imap, {
      folderPath: reference.folderPath, uid: reference.uid, expectedUidValidity: reference.uidValidity,
      draftIdentity: reference.draftIdentity, messageId: reference.messageId,
      beforeDelete: () => authorize(client, row, job),
    }));
}

async function completeJob(client, jobId) {
  await client.query(`UPDATE mail_draft_sync_jobs SET status = 'succeeded', completed_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, [jobId]);
}

async function rejectObsoleteJob(client, job, reason) {
  await client.query(`UPDATE mail_draft_sync_jobs SET status = 'failed', last_error = $2, completed_at = now(), updated_at = now() WHERE id = $1`, [job.id, reason]);
}

async function processUpsert(client, row, job) {
  if (row.abandoned_at || row.sync_status === 'DELETE_QUEUED' || row.sync_status === 'SENT') {
    await rejectObsoleteJob(client, job, "DRAFT_JOB_SUPERSEDED: brouillon abandonné ou déjà envoyé");
    return;
  }
  const previous = currentRemote(row, job);
  const mime = await mimeForDraft(row);
  const folderPath = row.draft_folder_path || row.draft_folder_name || "Drafts";
  await authorize(client, row, job);
  const appended = await withDraftImapClient(client, { organizationId: job.organization_id, mailAccountId: job.mail_account_id },
    imap => appendDraftWithClient(imap, {
      folderPath, mime, draftIdentity: row.draft_identity, internalDate: new Date(),
      beforeAppend: () => authorize(client, row, job),
    }));
  if (appended.requiresReconciliation || !Number.isSafeInteger(Number(appended.uid)) || Number(appended.uid) <= 0 || !appended.uidValidity) {
    throw new Error("Identité distante non confirmée après APPEND ; ancienne référence conservée.");
  }
  await authorize(client, row, job);
  const updated = await client.query(
    `UPDATE mail_drafts SET remote_folder_id = $4, remote_uid = $5, remote_uid_validity = $6,
       remote_modseq = $7, remote_version = $8, sync_status = 'SYNCED', local_dirty = false,
       last_remote_saved_at = now(), sync_error = NULL, updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3
       AND draft_identity = $9 AND local_version = $10 AND abandoned_at IS NULL
       AND sync_status NOT IN ('DELETE_QUEUED', 'SENT')`,
    [job.draft_id, job.organization_id, job.mail_account_id, row.draft_folder_id ?? null,
      appended.uid, String(appended.uidValidity), appended.highestModseq,
      `${appended.uidValidity}:${appended.uid}:${appended.highestModseq || ""}`,
      job.payload_json.generation, job.payload_json.localVersion]);
  if (updated.rowCount !== 1) {
    await rejectObsoleteJob(client, job, "DRAFT_JOB_SUPERSEDED: réponse APPEND d’une ancienne génération ignorée");
    return;
  }
  if (previous && (Number(previous.uid) !== Number(appended.uid) || previous.folderPath !== folderPath || String(previous.uidValidity) !== String(appended.uidValidity))) {
    try {
      await deleteRemote(client, row, job, previous);
    } catch (error) {
      // Retain the exact old mailbox reference. A future cleanup never reads the
      // current draft UID, which may already belong to another generation.
      await client.query(
        `INSERT INTO mail_draft_sync_jobs (organization_id, mail_account_id, draft_id, action, status, idempotency_key, payload_json, last_error, next_attempt_at)
         VALUES ($1, $2, $3, 'cleanup_old_version', $4, $5, $6::jsonb, $7, now())
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [job.organization_id, job.mail_account_id, job.draft_id, error.permanent ? 'failed' : 'queued',
          `draft-cleanup:${job.draft_id}:${job.payload_json.generation}:${previous.uidValidity}:${previous.uid}`,
          JSON.stringify({ generation: job.payload_json.generation, localVersion: job.payload_json.localVersion, remote: previous }),
          String(error.message || error).slice(0, 4000)]);
      logger.warn({ evt: "MAIL_DRAFT_OLD_DELETE_DEFERRED", draftId: job.draft_id }, error instanceof Error ? error.message : String(error));
    }
  }
  await authorize(client, row, job);
  await completeJob(client, job.id);
}

async function processDelete(client, row, job) {
  if (!row.abandoned_at) {
    await rejectObsoleteJob(client, job, "DRAFT_JOB_SUPERSEDED: suppression annulée par une modification locale");
    return;
  }
  const reference = currentRemote(row, job);
  if (reference) await deleteRemote(client, row, job, reference);
  await authorize(client, row, job);
  const removed = await client.query(
    `DELETE FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3
       AND draft_identity = $4 AND local_version = $5 AND abandoned_at IS NOT NULL`,
    [job.draft_id, job.organization_id, job.mail_account_id, job.payload_json.generation, job.payload_json.localVersion]);
  if (removed.rowCount !== 1) {
    await rejectObsoleteJob(client, job, "DRAFT_JOB_SUPERSEDED: réponse DELETE d’une ancienne génération ignorée");
    return;
  }
  await completeJob(client, job.id);
}

async function processCleanup(client, row, job) {
  const reference = job.payload_json.remote;
  // Never remove the reference that the current draft is still using.
  if (Number(row.remote_uid) === Number(reference.uid) && String(row.remote_uid_validity) === String(reference.uidValidity)) {
    await rejectObsoleteJob(client, job, "DRAFT_CLEANUP_REFUSED: référence distante encore utilisée");
    return;
  }
  await deleteRemote(client, row, job, reference);
  await authorize(client, row, job);
  await completeJob(client, job.id);
}

async function processJob(job) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!job.draft_id) {
      await rejectObsoleteJob(client, job, "DRAFT_JOB_SUPERSEDED: brouillon supprimé");
      await client.query("COMMIT");
      return;
    }
    await lockDraftTransaction(client, { organizationId: job.organization_id, draftId: job.draft_id });
    // Keep this row lock until the remote action and receipt finish. The reaper
    // cannot give a second worker a new lease while this request is in flight.
    const lease = await client.query(`SELECT id, status FROM mail_draft_sync_jobs WHERE id = $1 FOR UPDATE`, [job.id]);
    if (lease.rows[0]?.status !== 'running') { await client.query("COMMIT"); return; }
    const row = await loadDraftContext(client, job);
    if (!hasDraftJobFence(job)) {
      await rejectObsoleteJob(client, job, "DRAFT_LEGACY_JOB_UNVERIFIED: enregistrez de nouveau le brouillon pour synchroniser");
      if (row) await client.query(
        `UPDATE mail_drafts SET sync_status = 'ERROR', sync_error = $4, updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3 AND local_dirty = true`,
        [job.draft_id, job.organization_id, job.mail_account_id, "Ancienne tâche non vérifiable : réenregistrez ce brouillon."]);
    } else if (!matchesDraftJobFence(row, job)) {
      await rejectObsoleteJob(client, job, "DRAFT_JOB_SUPERSEDED: compte, génération ou version du brouillon modifié");
    } else {
      await authorize(client, row, job);
      const action = String(job.action || '').toLowerCase();
      if (action === 'save' || action === 'upsert') await processUpsert(client, row, job);
      else if (action === 'delete') await processDelete(client, row, job);
      else if (action === 'cleanup_old_version') await processCleanup(client, row, job);
      else throw draftFenceError("DRAFT_ACTION_INVALID", `Action draft inconnue: ${job.action}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function failJob(job, error) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (job.draft_id) await lockDraftTransaction(client, { organizationId: job.organization_id, draftId: job.draft_id });
    const attempts = (Number(job.attempt_count) || 0) + 1;
    const permanent = error.permanent === true || error.statusCode === 403 || attempts >= (Number(job.max_attempts) || 8);
    const message = `${error.code ? `${error.code}: ` : ''}${error instanceof Error ? error.message : String(error)}`;
    await client.query(
      `UPDATE mail_draft_sync_jobs SET status = $2, attempt_count = $3, next_attempt_at = $4,
         last_error = $5, updated_at = now() WHERE id = $1 AND status = 'running'`,
      [job.id, permanent ? 'failed' : 'retrying', attempts, new Date(Date.now() + delayMsAfterFailedAttempt(attempts)), message.slice(0, 4000)]);
    if (job.draft_id && hasDraftJobFence(job)) await client.query(
      `UPDATE mail_drafts SET sync_status = $4, sync_error = $5, updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND mail_account_id = $3 AND draft_identity = $6 AND local_version = $7`,
      [job.draft_id, job.organization_id, job.mail_account_id, permanent ? 'ERROR' : 'OFFLINE', message.slice(0, 1000), job.payload_json.generation, job.payload_json.localVersion]);
    await client.query("COMMIT");
  } catch (failure) { await client.query("ROLLBACK"); throw failure; }
  finally { client.release(); }
}

export async function processMailDraftSyncBatch() {
  const client = await pool.connect();
  let jobs;
  try {
    await client.query("BEGIN");
    jobs = await claimDraftJobs(client, BATCH);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  for (const job of jobs) {
    try { await processJob(job); }
    catch (error) { await failJob(job, error); }
  }
  return { processed: jobs.length };
}

export async function reapStuckDraftSyncJobs(maxMinutes = STUCK_MINUTES) {
  const result = await pool.query(
    `UPDATE mail_draft_sync_jobs SET status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE 'retrying' END,
       attempt_count = attempt_count + 1, next_attempt_at = now(), last_error = 'Job brouillon bloque repris automatiquement', updated_at = now()
     WHERE status = 'running' AND locked_at < now() - ($1 * interval '1 minute') RETURNING id`, [maxMinutes]);
  return { reaped: result.rowCount };
}
