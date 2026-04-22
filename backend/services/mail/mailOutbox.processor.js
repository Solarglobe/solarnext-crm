/**
 * Worker — prise en charge des envois (SKIP LOCKED), SMTP, mise à jour statuts.
 */

import fs from "fs/promises";
import { pool } from "../../config/db.js";
import { getAbsolutePath } from "../localStorage.service.js";
import {
  loadActiveMailAccountWithSmtpCredentials,
  sendMailNodemailerOnly,
  inferSmtpFailureCode,
} from "./smtp.service.js";
import {
  finalizeOutboundSentInTransaction,
  markOutboundMessageFailedInTransaction,
  markOutboundMessageQueuedInTransaction,
} from "./mailSendFinalize.service.js";
import { delayMsAfterFailedAttempt } from "./mailOutboxBackoff.service.js";
import { emitEventAsync } from "../core/eventBus.service.js";
import logger from "../../app/core/logger.js";

const BATCH = Math.min(Math.max(Number(process.env.MAIL_OUTBOX_BATCH) || 8, 1), 32);

/**
 * @param {import('pg').PoolClient} client
 * @param {number} limit
 */
async function claimOutboxJobs(client, limit) {
  const r = await client.query(
    `WITH cte AS (
      SELECT id FROM mail_outbox
      WHERE status IN ('queued', 'retrying')
        AND next_attempt_at <= now()
        AND attempt_count < max_attempts
      ORDER BY next_attempt_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE mail_outbox mo SET
      status = 'sending',
      last_attempt_at = now(),
      updated_at = now()
    FROM cte
    WHERE mo.id = cte.id
    RETURNING mo.*`,
    [limit]
  );
  return r.rows;
}

/**
 * @param {string} messageId
 */
async function loadParticipants(messageId) {
  const r = await pool.query(
    `SELECT type, email FROM mail_participants WHERE mail_message_id = $1 ORDER BY type, email`,
    [messageId]
  );
  const to = [];
  const cc = [];
  const bcc = [];
  for (const row of r.rows) {
    if (row.type === "TO") to.push(row.email);
    if (row.type === "CC") cc.push(row.email);
    if (row.type === "BCC") bcc.push(row.email);
  }
  return { to, cc, bcc };
}

/**
 * @param {string} messageId
 * @param {string} organizationId
 */
async function loadAttachmentBuffers(messageId, organizationId) {
  const r = await pool.query(
    `SELECT file_name, mime_type, storage_path
     FROM mail_attachments
     WHERE mail_message_id = $1 AND organization_id = $2 AND storage_path IS NOT NULL`,
    [messageId, organizationId]
  );
  /** @type {import('nodemailer').SendMailOptions['attachments']} */
  const out = [];
  for (const a of r.rows) {
    try {
      const abs = getAbsolutePath(a.storage_path);
      const content = await fs.readFile(abs);
      out.push({
        filename: a.file_name || "attachment",
        content,
        contentType: a.mime_type || undefined,
      });
    } catch (e) {
      logger.error(
        { evt: "MAIL_OUTBOX_ATTACHMENT_READ_FAIL", messageId, path: a.storage_path },
        e instanceof Error ? e.message : String(e)
      );
      throw e;
    }
  }
  return out;
}

/**
 * @param {Record<string, unknown>} job
 */
async function deliverOutboxJob(job) {
  const organizationId = String(job.organization_id);
  const mailAccountId = String(job.mail_account_id);
  const messageId = String(job.mail_message_id);
  const threadId = job.mail_thread_id ? String(job.mail_thread_id) : null;

  const msgRes = await pool.query(
    `SELECT body_text, body_html, subject, in_reply_to, references_ids
     FROM mail_messages WHERE id = $1 AND organization_id = $2`,
    [messageId, organizationId]
  );
  if (msgRes.rows.length === 0) {
    throw new Error("Message CRM introuvable pour envoi");
  }
  const msg = msgRes.rows[0];
  const { to, cc, bcc } = await loadParticipants(messageId);
  if (!to.length) {
    throw new Error("Aucun destinataire TO sur le message");
  }

  const refs = Array.isArray(msg.references_ids)
    ? msg.references_ids.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const { acc, password, smtpUser } = await loadActiveMailAccountWithSmtpCredentials(pool, {
    organizationId,
    mailAccountId,
  });

  const fromName = job.from_name != null ? String(job.from_name).trim() : "";
  const fromHeader = fromName
    ? `"${fromName.replace(/"/g, "")}" <${acc.email}>`
    : acc.email;

  const nodemailerAttachments = await loadAttachmentBuffers(messageId, organizationId);

  const replyTo = job.reply_to != null && String(job.reply_to).trim() ? String(job.reply_to).trim() : null;
  const inReplyTo = msg.in_reply_to != null && String(msg.in_reply_to).trim() ? String(msg.in_reply_to).trim() : null;

  const subj = msg.subject?.trim() || "(sans objet)";

  logger.info(
    {
      evt: "MAIL_OUTBOX_SMTP_TRY",
      outboxId: job.id,
      messageId,
      mailAccountId,
      attempt: job.attempt_count,
    },
    "Envoi SMTP (file)"
  );

  const { info } = await sendMailNodemailerOnly({
    acc,
    password,
    smtpAuthUser: smtpUser,
    fromHeader,
    to,
    cc,
    bcc,
    subject: subj,
    bodyText: msg.body_text,
    bodyHtml: msg.body_html,
    replyTo,
    inReplyTo,
    references: refs.length ? refs : null,
    nodemailerAttachments,
  });

  const smtpMessageId = info.messageId ? String(info.messageId).trim() : null;
  const providerResponse =
    typeof info.response === "string"
      ? info.response.slice(0, 8000)
      : JSON.stringify(info.response ?? "").slice(0, 8000);

  const sentAt = new Date();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE mail_outbox SET
        status = 'sent',
        sent_at = $2,
        provider_message_id = $3,
        last_error = NULL,
        updated_at = now()
       WHERE id = $1`,
      [job.id, sentAt, smtpMessageId]
    );
    if (!threadId) {
      throw new Error("mail_thread_id manquant");
    }
    await finalizeOutboundSentInTransaction(client, {
      organizationId,
      messageId,
      threadId,
      mailAccountId,
      smtpMessageId,
      sentAt,
      providerResponse,
    });
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  emitEventAsync("MAIL_SENT", {
    messageId,
    threadId,
    organizationId,
    userId: job.created_by,
    mailAccountId,
  });

  logger.info(
    {
      evt: "MAIL_OUTBOX_SENT",
      outboxId: job.id,
      messageId,
      smtpMessageId,
    },
    "Message envoyé (file)"
  );
}

/**
 * @param {Record<string, unknown>} job
 * @param {unknown} err
 */
async function handleOutboxDeliveryFailure(job, err) {
  const code = inferSmtpFailureCode(err);
  const msg = err instanceof Error ? err.message : String(err);
  const prev = Number(job.attempt_count) || 0;
  const newAttempts = prev + 1;
  const maxAttempts = Number(job.max_attempts) || 4;
  const permanent = newAttempts >= maxAttempts;
  const delayMs = delayMsAfterFailedAttempt(newAttempts);

  const organizationId = String(job.organization_id);
  const messageId = String(job.mail_message_id);
  const threadId = job.mail_thread_id ? String(job.mail_thread_id) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (permanent) {
      await client.query(
        `UPDATE mail_outbox SET
          status = 'failed',
          attempt_count = $2,
          last_error = $3,
          updated_at = now()
         WHERE id = $1`,
        [job.id, newAttempts, msg.slice(0, 8000)]
      );
      if (threadId) {
        await markOutboundMessageFailedInTransaction(client, {
          organizationId,
          messageId,
          threadId,
          failureCode: code,
          failureReason: msg.slice(0, 2000),
          providerResponse: null,
        });
      }
    } else {
      const nextAt = new Date(Date.now() + delayMs);
      await client.query(
        `UPDATE mail_outbox SET
          status = 'retrying',
          attempt_count = $2,
          last_error = $3,
          next_attempt_at = $4,
          updated_at = now()
         WHERE id = $1`,
        [job.id, newAttempts, msg.slice(0, 8000), nextAt]
      );
      if (threadId) {
        await markOutboundMessageQueuedInTransaction(client, {
          organizationId,
          messageId,
          threadId,
        });
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }

  logger.warn(
    {
      evt: permanent ? "MAIL_OUTBOX_ABANDON" : "MAIL_OUTBOX_RETRY_SCHEDULED",
      outboxId: job.id,
      messageId,
      attempt: newAttempts,
      maxAttempts,
      nextDelayMs: permanent ? null : delayMs,
      code,
    },
    msg.slice(0, 500)
  );
}

/**
 * Traite jusqu’à `BATCH` messages — safe avec plusieurs workers (SKIP LOCKED).
 */
export async function processMailOutboxBatch() {
  const client = await pool.connect();
  /** @type {Record<string, unknown>[]} */
  let jobs = [];
  try {
    await client.query("BEGIN");
    jobs = await claimOutboxJobs(client, BATCH);
    if (jobs.length === 0) {
      await client.query("ROLLBACK");
      return { processed: 0 };
    }
    for (const job of jobs) {
      await client.query(
        `UPDATE mail_messages SET status = 'SENDING'::mail_message_status
         WHERE id = $1 AND organization_id = $2`,
        [job.mail_message_id, job.organization_id]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    logger.error({ evt: "MAIL_OUTBOX_CLAIM_ERR" }, e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    client.release();
  }

  for (const job of jobs) {
    try {
      await deliverOutboxJob(job);
    } catch (err) {
      try {
        await handleOutboxDeliveryFailure(job, err);
      } catch (e2) {
        logger.error(
          { evt: "MAIL_OUTBOX_FAILURE_PERSIST_ERR", outboxId: job.id },
          e2 instanceof Error ? e2.message : String(e2)
        );
      }
    }
  }

  return { processed: jobs.length };
}
