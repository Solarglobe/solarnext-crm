import { pool } from "../../config/db.js";
import logger from "../../app/core/logger.js";
import { delayMsAfterFailedAttempt } from "./mailOutboxBackoff.service.js";
import { withDraftImapClient } from "./mailImapDraftProvider.service.js";
import { ensureSentMessageWithClient } from "./mailSentArchiveProvider.service.js";
import { buildSimpleRfc822Mime } from "./mailMimeBuilder.service.js";
import { rebuildThreadMetadata } from "./mailThreading.service.js";

const BATCH = Math.min(Math.max(Number(process.env.MAIL_SENT_ARCHIVE_BATCH) || 6, 1), 24);

async function claimSentJobs(client, limit) {
  const r = await client.query(
    `WITH cte AS (
       SELECT mo.id FROM mail_outbox mo
       JOIN mail_accounts a ON a.id = mo.mail_account_id AND a.organization_id = mo.organization_id
       WHERE mo.smtp_completed_at IS NOT NULL
         AND mo.status = 'sent'
         AND mo.sent_archive_status IN ('pending', 'retrying', 'failed')
         AND COALESCE(mo.sent_archive_next_attempt_at, now()) <= now()
         AND a.is_active = true
         AND a.lifecycle_state IN ('CONNECTED', 'DEGRADED')
         AND a.sync_enabled = true
         AND a.reconnect_required = false
       ORDER BY mo.sent_archive_next_attempt_at ASC NULLS FIRST, mo.sent_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE mail_outbox mo SET
       sent_archive_status = 'running',
       updated_at = now()
     FROM cte
     WHERE mo.id = cte.id
     RETURNING mo.*`,
    [limit]
  );
  return r.rows;
}

async function loadSentContext(job) {
  const r = await pool.query(
    `SELECT mo.*, m.subject, m.body_text, m.body_html, m.in_reply_to, m.references_ids,
            a.email AS account_email, a.display_name AS account_display_name,
            f.id AS sent_folder_id_real, f.external_id AS sent_folder_path, f.name AS sent_folder_name
       FROM mail_outbox mo
       JOIN mail_messages m ON m.id = mo.mail_message_id AND m.organization_id = mo.organization_id
       JOIN mail_accounts a ON a.id = mo.mail_account_id AND a.organization_id = mo.organization_id
       LEFT JOIN mail_folders f ON f.mail_account_id = mo.mail_account_id
        AND f.organization_id = mo.organization_id
        AND f.type = 'SENT'
        AND f.is_active = true
      WHERE mo.id = $1`,
    [job.id]
  );
  const row = r.rows[0];
  if (!row) throw new Error("Outbox Sent introuvable");
  return row;
}

async function participants(messageId) {
  const r = await pool.query(`SELECT type, email FROM mail_participants WHERE mail_message_id = $1`, [messageId]);
  return {
    to: r.rows.filter((x) => x.type === "TO").map((x) => x.email),
    cc: r.rows.filter((x) => x.type === "CC").map((x) => x.email),
    bcc: r.rows.filter((x) => x.type === "BCC").map((x) => x.email),
  };
}

async function fallbackMime(ctx) {
  const p = await participants(ctx.mail_message_id);
  return buildSimpleRfc822Mime({
    messageId: ctx.stable_message_id || ctx.provider_message_id,
    from: ctx.account_display_name ? `"${String(ctx.account_display_name).replace(/"/g, "")}" <${ctx.account_email}>` : ctx.account_email,
    to: p.to,
    cc: p.cc,
    bcc: p.bcc,
    subject: ctx.subject,
    bodyText: ctx.body_text,
    bodyHtml: ctx.body_html,
    inReplyTo: ctx.in_reply_to,
    references: ctx.references_ids,
    attachments: [],
  });
}

async function markSentFailed(job, err) {
  const attempts = Number(job.sent_archive_attempt_count || 0) + 1;
  const msg = err instanceof Error ? err.message : String(err);
  await pool.query(
    `UPDATE mail_outbox SET
       sent_archive_status = 'retrying',
       sent_archive_attempt_count = $2,
       sent_archive_next_attempt_at = $3,
       sent_archive_error = $4,
       updated_at = now()
     WHERE id = $1`,
    [job.id, attempts, new Date(Date.now() + delayMsAfterFailedAttempt(attempts)), msg.slice(0, 4000)]
  );
  await pool.query(
    `UPDATE mail_messages SET failure_code = 'SENT_ARCHIVE_PENDING',
        failure_reason = 'Message envoye, classement dans Envoyes en attente'
      WHERE id = $1 AND organization_id = $2 AND status = 'SENT'::mail_message_status`,
    [job.mail_message_id, job.organization_id]
  );
}

async function processSentJob(job) {
  const ctx = await loadSentContext(job);
  const folderPath = ctx.sent_folder_path || ctx.sent_folder_name || "Sent";
  const mime = ctx.smtp_mime_rfc822 || await fallbackMime(ctx);
  const messageId = ctx.stable_message_id || ctx.provider_message_id;
  if (!messageId) throw new Error("Message-ID stable manquant pour Sent");
  const result = await withDraftImapClient(pool, {
    organizationId: String(ctx.organization_id),
    mailAccountId: String(ctx.mail_account_id),
  }, (imap) => ensureSentMessageWithClient(imap, {
    folderPath,
    messageId,
    mime,
    sentAt: ctx.sent_at || ctx.smtp_completed_at || new Date(),
  }));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE mail_outbox SET
         sent_archive_status = 'done',
         sent_archive_error = NULL,
         sent_archive_next_attempt_at = NULL,
         sent_folder_id = COALESCE($2, sent_folder_id),
         sent_remote_uid = $3,
         sent_remote_uid_validity = $4,
         updated_at = now()
       WHERE id = $1`,
      [ctx.id, ctx.sent_folder_id_real, result.uid, result.uidValidity || null]
    );
    await client.query(
      `UPDATE mail_messages SET
         folder_id = COALESCE($3, folder_id),
         external_uid = COALESCE($4, external_uid),
         external_uid_validity = COALESCE($5, external_uid_validity),
         sync_source = 'SMTP_SENT_ARCHIVE',
         failure_code = NULL,
         failure_reason = NULL
       WHERE id = $1 AND organization_id = $2`,
      [ctx.mail_message_id, ctx.organization_id, ctx.sent_folder_id_real, result.uid, result.uidValidity || null]
    );
    if (ctx.mail_thread_id) await rebuildThreadMetadata({ client, threadId: ctx.mail_thread_id });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return result;
}

export async function processMailSentArchiveBatch() {
  const client = await pool.connect();
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimSentJobs(client, BATCH);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  for (const job of jobs) {
    try {
      await processSentJob(job);
    } catch (e) {
      await markSentFailed(job, e);
      logger.warn({ evt: "MAIL_SENT_ARCHIVE_RETRY", outboxId: job.id }, e instanceof Error ? e.message : String(e));
    }
  }
  return { processed: jobs.length };
}

