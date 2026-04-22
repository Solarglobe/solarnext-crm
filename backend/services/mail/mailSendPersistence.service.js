/**
 * CP-071 — Persistance envois sortants (threads, messages, participants, pièces jointes métadonnées).
 * CP-085 — L’événement MAIL_SENT est émis depuis smtp.service.js après COMMIT (pas ici, pour rester cohérent transactionnel).
 */

import fs from "fs/promises";
import path from "path";
import {
  resolveThreadForMessage,
  rebuildThreadMetadata,
  normalizeSubjectForThreading,
} from "./mailThreading.service.js";
import { syncCrmLinkForNewMessage } from "./mailSyncPersistence.service.js";
import { processAttachmentsFromBufferRows } from "./mailAttachments.service.js";
/**
 * @param {import('pg').PoolClient} client
 */
export async function getSentFolderId(client, { organizationId, mailAccountId }) {
  const r = await client.query(
    `SELECT id FROM mail_folders
     WHERE organization_id = $1 AND mail_account_id = $2 AND type = 'SENT'
     LIMIT 1`,
    [organizationId, mailAccountId]
  );
  return r.rows[0]?.id ?? null;
}

function snippetFromBodies(bodyText, bodyHtml) {
  const t = bodyText?.trim() || "";
  if (t) return t.length > 240 ? `${t.slice(0, 237)}…` : t;
  if (bodyHtml) {
    const stripped = String(bodyHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return stripped.length > 240 ? `${stripped.slice(0, 237)}…` : stripped;
  }
  return "";
}

/**
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   accountEmail: string,
 *   accountDisplayName: string | null,
 *   fromName: string | null | undefined,
 *   subject: string,
 *   bodyText: string | null | undefined,
 *   bodyHtml: string | null | undefined,
 *   to: string[],
 *   cc: string[],
 *   bcc: string[],
 *   replyTo: string | null | undefined,
 *   inReplyTo: string | null | undefined,
 *   referencesIds: string[] | null | undefined,
 *   smtpMessageId: string | null,
 *   status: 'SENT' | 'FAILED' | 'QUEUED' | 'SENDING',
 *   sentAt: Date | null,
 *   folderId: string | null,
 *   failureCode: string | null,
 *   failureReason: string | null,
 *   providerResponse: string | null,
 *   hasAttachments: boolean,
 *   trackingId?: string | null,
 *   attachmentRows?: Array<{
 *     file_name: string,
 *     mime_type: string | null,
 *     size_bytes: number | null,
 *     storage_path: string | null,
 *     buffer: Buffer,
 *     is_inline?: boolean,
 *     content_id?: string | null,
 *   }>,
 * }} p
 */
export async function persistOutboundInTransaction(client, p) {
  const {
    organizationId,
    mailAccountId,
    accountEmail,
    accountDisplayName,
    fromName,
    subject,
    bodyText,
    bodyHtml,
    to,
    cc,
    bcc,
    replyTo,
    inReplyTo,
    referencesIds,
    smtpMessageId,
    status,
    sentAt,
    folderId,
    failureCode,
    failureReason,
    providerResponse,
    hasAttachments,
    trackingId = null,
    attachmentRows = [],
  } = p;

  const subj = subject?.trim() || "(sans objet)";
  const snip = snippetFromBodies(bodyText || "", bodyHtml || "");

  const participantEmails = [...new Set([accountEmail, ...to, ...cc, ...bcc].map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

  const resolved = await resolveThreadForMessage(client, {
    organizationId,
    mailAccountId,
    accountEmail,
    messageId: smtpMessageId || null,
    inReplyTo: inReplyTo ? String(inReplyTo).trim() : null,
    referencesIds: referencesIds || [],
    subject: subj,
    messageDate: sentAt || new Date(),
    participantEmails,
  });

  let threadId = resolved.threadId;
  if (!threadId) {
    const th = await client.query(
      `INSERT INTO mail_threads (
        organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject
      ) VALUES ($1, $2, $3, now(), true, false, 0, $4)
      RETURNING id`,
      [organizationId, subj, snip, normalizeSubjectForThreading(subj)]
    );
    threadId = th.rows[0].id;
  }

  const inReplyNorm = inReplyTo ? String(inReplyTo).trim() : null;
  const refsArray = referencesIds?.length ? referencesIds.map((x) => String(x).trim()).filter(Boolean) : null;

  const msgIns = await client.query(
    `INSERT INTO mail_messages (
      organization_id, mail_thread_id, mail_account_id, folder_id,
      message_id, in_reply_to, references_ids,
      subject, body_text, body_html,
      direction, status, sent_at, received_at,
      is_read, has_attachments,
      failure_code, failure_reason, retry_count, last_retry_at, provider_response,
      tracking_id
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10,
      'OUTBOUND', $11::mail_message_status, $12, NULL,
      true, $13,
      $14, $15, 0, NULL, $16,
      $17
    )
    RETURNING id`,
    [
      organizationId,
      threadId,
      mailAccountId,
      folderId,
      smtpMessageId,
      inReplyNorm,
      refsArray,
      subj,
      bodyText ?? null,
      bodyHtml ?? null,
      status,
      sentAt,
      hasAttachments,
      failureCode,
      failureReason,
      providerResponse,
      trackingId,
    ]
  );

  const persistedMessageId = msgIns.rows[0].id;

  const fromLabel = fromName?.trim() || accountDisplayName?.trim() || null;
  await client.query(
    `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
     VALUES ($1, $2, 'FROM', $3, $4)`,
    [organizationId, persistedMessageId, accountEmail, fromLabel]
  );

  const addRecipients = async (emails, type) => {
    for (const raw of emails) {
      const e = String(raw).trim();
      if (!e) continue;
      await client.query(
        `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
         VALUES ($1, $2, $3::mail_participant_type, $4, NULL)`,
        [organizationId, persistedMessageId, type, e]
      );
    }
  };

  await addRecipients(to, "TO");
  await addRecipients(cc, "CC");
  await addRecipients(bcc, "BCC");

  await syncCrmLinkForNewMessage({ messageId: persistedMessageId, dbClient: client });

  if (attachmentRows.length > 0) {
    await processAttachmentsFromBufferRows({
      dbClient: client,
      messageId: persistedMessageId,
      organizationId,
      bufferItems: attachmentRows,
    });
  }

  await rebuildThreadMetadata({ client, threadId });

  return { threadId, messageId: persistedMessageId };
}

/**
 * Message sortant en attente d’envoi SMTP (file d’attente) — même threading que l’envoi direct.
 * @param {Omit<Parameters<typeof persistOutboundInTransaction>[1], 'status' | 'sentAt' | 'smtpMessageId' | 'failureCode' | 'failureReason' | 'providerResponse' | 'folderId'> & { status?: never }} p
 */
export async function persistQueuedOutboundInTransaction(client, p) {
  const {
    organizationId,
    mailAccountId,
    accountEmail,
    accountDisplayName,
    fromName,
    subject,
    bodyText,
    bodyHtml,
    to,
    cc,
    bcc,
    replyTo,
    inReplyTo,
    referencesIds,
    hasAttachments,
    trackingId = null,
    attachmentRows = [],
  } = p;

  return persistOutboundInTransaction(client, {
    organizationId,
    mailAccountId,
    accountEmail,
    accountDisplayName,
    fromName,
    subject,
    bodyText,
    bodyHtml,
    to,
    cc,
    bcc,
    replyTo,
    inReplyTo,
    referencesIds,
    smtpMessageId: null,
    status: "QUEUED",
    sentAt: null,
    folderId: null,
    failureCode: null,
    failureReason: null,
    providerResponse: null,
    hasAttachments,
    attachmentRows,
    trackingId,
  });
}

/**
 * Prépare les pièces jointes (buffer ou fichier) en métadonnées pour persistance.
 * @param {Array<{ filename?: string, content?: Buffer|string, path?: string, contentType?: string, contentBase64?: string }>} attachments
 */
export async function buildAttachmentRows(attachments) {
  if (!attachments?.length) return [];
  const rows = [];
  for (const a of attachments) {
    const file_name = a.filename || path.basename(a.path || "attachment");
    let buf;
    if (a.contentBase64 != null && String(a.contentBase64).trim() !== "") {
      buf = Buffer.from(String(a.contentBase64).replace(/\s/g, ""), "base64");
    } else if (a.content != null) {
      buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), "utf8");
    } else if (a.path) {
      const resolved = path.resolve(a.path);
      buf = await fs.readFile(resolved);
    } else {
      continue;
    }
    rows.push({
      file_name,
      mime_type: a.contentType || null,
      size_bytes: buf.length,
      storage_path: null,
      buffer: buf,
      is_inline: false,
      content_id: null,
    });
  }
  return rows;
}
