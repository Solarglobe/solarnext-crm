/**
 * File d’envoi mail — création, liste, annulation, relance manuelle.
 */

import { pool } from "../../config/db.js";
import { canSendMailAccount } from "../mailAccess.service.js";
import {
  persistQueuedOutboundInTransaction,
  buildAttachmentRows,
} from "./mailSendPersistence.service.js";
import { applyTrackingToHtml, generateTrackingId, isMailTrackingEnabled } from "./mailTracking.service.js";
import { parseAddressList, SmtpErrorCodes } from "./smtp.service.js";

const DEFAULT_MAX_ATTEMPTS = () => {
  const n = Number(process.env.MAIL_OUTBOX_MAX_ATTEMPTS);
  if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.floor(n);
  return 4;
};

/**
 * @param {unknown} body
 */
function parseRefs(body) {
  const { references } = body || {};
  if (references == null) return null;
  return Array.isArray(references) ? references : [references];
}

/**
 * @param {{
 *   userId: string,
 *   organizationId: string,
 *   body: Record<string, unknown>,
 *   isSuperAdmin?: boolean,
 * }} p
 */
export async function enqueueOutboundMail(p) {
  const { userId, organizationId, body, isSuperAdmin = false } = p;
  const {
    mail_account_id: mailAccountIdRaw,
    mailAccountId: mailAccountIdAlt,
    to,
    cc,
    bcc,
    subject,
    bodyText,
    bodyHtml,
    replyTo,
    inReplyTo,
    references,
    attachments,
    fromName,
    max_attempts: maxAttemptsRaw,
  } = body || {};

  const mailAccountId = mailAccountIdRaw || mailAccountIdAlt;
  if (!mailAccountId || typeof mailAccountId !== "string") {
    const err = new Error("mail_account_id requis");
    err.code = SmtpErrorCodes.INVALID_CONFIG;
    throw err;
  }

  const toList = parseAddressList(to);
  if (!toList.length) {
    const err = new Error("Au moins un destinataire (to) est requis");
    err.code = SmtpErrorCodes.INVALID_CONFIG;
    throw err;
  }
  if (!String(bodyText || "").trim() && !String(bodyHtml || "").trim()) {
    const err = new Error("bodyText ou bodyHtml requis");
    err.code = SmtpErrorCodes.INVALID_CONFIG;
    throw err;
  }

  if (!isSuperAdmin) {
    const ok = await canSendMailAccount({
      userId,
      organizationId,
      mailAccountId,
      action: "send",
    });
    if (!ok) {
      const err = new Error("Envoi refusé pour ce compte");
      err.code = "MAIL_SEND_DENIED";
      throw err;
    }
  }

  const refs = parseRefs(body);
  let bodyHtmlForStore = bodyHtml;
  let trackingId = null;
  if (String(bodyHtml || "").trim() && isMailTrackingEnabled()) {
    trackingId = generateTrackingId();
    bodyHtmlForStore = applyTrackingToHtml(String(bodyHtml), trackingId);
  }

  const ccList = parseAddressList(cc);
  const bccList = parseAddressList(bcc);
  const attachmentRows = await buildAttachmentRows(attachments);

  const maxAttempts = (() => {
    const n = Number(maxAttemptsRaw);
    if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.floor(n);
    return DEFAULT_MAX_ATTEMPTS();
  })();

  const trackingEnabled = isMailTrackingEnabled() && String(bodyHtml || "").trim().length > 0;

  const subj = String(subject || "").trim() || "(sans objet)";
  const replyToStr = replyTo != null && String(replyTo).trim() ? String(replyTo).trim() : null;
  const inReplyToStr = inReplyTo != null && String(inReplyTo).trim() ? String(inReplyTo).trim() : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const accRow = await client.query(
      `SELECT email, display_name FROM mail_accounts WHERE id = $1 AND organization_id = $2`,
      [mailAccountId, organizationId]
    );
    if (accRow.rows.length === 0) {
      const err = new Error("Compte mail introuvable");
      err.code = SmtpErrorCodes.INVALID_CONFIG;
      throw err;
    }
    const { email: accountEmail, display_name: accountDisplayName } = accRow.rows[0];

    const { threadId, messageId } = await persistQueuedOutboundInTransaction(client, {
      organizationId,
      mailAccountId,
      accountEmail,
      accountDisplayName,
      fromName,
      subject: subj,
      bodyText,
      bodyHtml: bodyHtmlForStore,
      to: toList,
      cc: ccList,
      bcc: bccList,
      replyTo: replyToStr,
      inReplyTo: inReplyToStr,
      referencesIds: refs,
      hasAttachments: attachmentRows.length > 0,
      attachmentRows,
      trackingId,
    });

    const ins = await client.query(
      `INSERT INTO mail_outbox (
        organization_id, mail_account_id, created_by, mail_message_id, mail_thread_id,
        to_json, cc_json, bcc_json, subject, body_html, body_text, from_name,
        in_reply_to, reply_to, references_json, tracking_enabled,
        status, attempt_count, max_attempts, next_attempt_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12,
        $13, $14, $15::jsonb, $16,
        'queued', 0, $17, now()
      )
      RETURNING id, status`,
      [
        organizationId,
        mailAccountId,
        userId,
        messageId,
        threadId,
        JSON.stringify(toList),
        JSON.stringify(ccList),
        JSON.stringify(bccList),
        subj,
        bodyHtmlForStore,
        bodyText ?? null,
        fromName?.trim() || null,
        inReplyToStr,
        replyToStr,
        refs?.length ? JSON.stringify(refs) : null,
        trackingEnabled,
        maxAttempts,
      ]
    );

    await client.query("COMMIT");

    const row = ins.rows[0];
    return {
      success: true,
      outboxId: row.id,
      messageId,
      threadId,
      status: row.status,
    };
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
}

/**
 * @param {{
 *   organizationId: string,
 *   accessibleAccountIds: Set<string>,
 *   status?: string | null,
 *   limit?: number,
 *   offset?: number,
 * }} p
 */
export async function listMailOutbox(p) {
  const { organizationId, accessibleAccountIds, status, limit = 50, offset = 0 } = p;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  const accIds = [...accessibleAccountIds];
  if (accIds.length === 0) return { items: [], total: 0 };

  const params = [organizationId, accIds];
  let idx = 3;
  let statusClause = "";
  if (status && typeof status === "string" && status.trim()) {
    statusClause = ` AND mo.status = $${idx}::mail_outbox_status`;
    params.push(status.trim().toLowerCase());
    idx++;
  }

  const countR = await pool.query(
    `SELECT count(*)::int AS n FROM mail_outbox mo
     WHERE mo.organization_id = $1 AND mo.mail_account_id = ANY($2::uuid[])
     ${statusClause}`,
    params
  );
  const total = countR.rows[0]?.n ?? 0;

  const listParams = [...params, lim, off];
  const r = await pool.query(
    `SELECT mo.id, mo.status, mo.attempt_count, mo.max_attempts, mo.next_attempt_at, mo.sent_at,
            mo.last_error, mo.last_attempt_at, mo.created_at, mo.updated_at,
            mo.mail_message_id, mo.mail_thread_id, mo.subject,
            ma.email AS account_email
     FROM mail_outbox mo
     INNER JOIN mail_accounts ma ON ma.id = mo.mail_account_id
     WHERE mo.organization_id = $1 AND mo.mail_account_id = ANY($2::uuid[])
     ${statusClause}
     ORDER BY mo.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    listParams
  );

  const items = r.rows.map((row) => ({
    id: row.id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    lastError: row.last_error,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    mailMessageId: row.mail_message_id,
    threadId: row.mail_thread_id,
    subject: row.subject,
    accountEmail: row.account_email,
  }));

  return { items, total };
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   accessibleAccountIds: Set<string>,
 *   outboxId: string,
 * }} p
 */
export async function cancelMailOutbox(p) {
  const { organizationId, outboxId, accessibleAccountIds } = p;
  const accIds = [...accessibleAccountIds];
  if (accIds.length === 0) return { ok: false, code: "MAIL_ACCESS_DENIED" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT mo.id, mo.mail_message_id, mo.mail_thread_id, mo.status
       FROM mail_outbox mo
       WHERE mo.id = $1 AND mo.organization_id = $2 AND mo.mail_account_id = ANY($3::uuid[])
       FOR UPDATE`,
      [outboxId, organizationId, accIds]
    );
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "NOT_FOUND" };
    }
    const row = r.rows[0];
    if (row.status === "sent" || row.status === "cancelled" || row.status === "sending") {
      await client.query("ROLLBACK");
      return { ok: false, code: "INVALID_STATE" };
    }

    await client.query(
      `UPDATE mail_outbox SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [outboxId]
    );
    await client.query(
      `UPDATE mail_messages SET
        status = 'FAILED'::mail_message_status,
        failure_code = $2,
        failure_reason = $3
       WHERE id = $1 AND organization_id = $4`,
      [row.mail_message_id, "CANCELLED", "Envoi annulé", organizationId]
    );
    await client.query("COMMIT");
    return { ok: true };
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
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   accessibleAccountIds: Set<string>,
 *   outboxId: string,
 * }} p
 */
export async function retryMailOutbox(p) {
  const { organizationId, outboxId, accessibleAccountIds } = p;
  const accIds = [...accessibleAccountIds];
  if (accIds.length === 0) return { ok: false, code: "MAIL_ACCESS_DENIED" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT mo.id, mo.status, mo.mail_message_id, mo.attempt_count, mo.max_attempts
       FROM mail_outbox mo
       WHERE mo.id = $1 AND mo.organization_id = $2 AND mo.mail_account_id = ANY($3::uuid[])
       FOR UPDATE`,
      [outboxId, organizationId, accIds]
    );
    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, code: "NOT_FOUND" };
    }
    const row = r.rows[0];
    if (row.status !== "failed") {
      await client.query("ROLLBACK");
      return { ok: false, code: "INVALID_STATE" };
    }

    await client.query(
      `UPDATE mail_outbox SET
        status = 'queued',
        next_attempt_at = now(),
        attempt_count = 0,
        last_error = NULL,
        updated_at = now()
       WHERE id = $1`,
      [outboxId]
    );
    await client.query(
      `UPDATE mail_messages SET
        status = 'QUEUED'::mail_message_status,
        failure_code = NULL,
        failure_reason = NULL
       WHERE id = $1 AND organization_id = $2`,
      [row.mail_message_id, organizationId]
    );
    await client.query("COMMIT");
    return { ok: true };
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
}
