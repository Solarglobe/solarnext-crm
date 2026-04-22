/**
 * CP-075 — Pièces jointes mail → fichiers + entity_documents + mail_attachments.
 */

import { createHash } from "crypto";
import { uploadMailAttachmentFile } from "../localStorage.service.js";
import { resolveSystemDocumentMetadata } from "../documentMetadata.service.js";

/** ~20 Mo — au-delà : ignoré (log), pas de stockage. */
export const MAX_MAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * @param {unknown} att
 * @param {number} index
 * @returns {string}
 */
function attachmentFileName(att, index) {
  const a = att && typeof att === "object" ? att : {};
  const raw =
    (typeof a.filename === "string" && a.filename) ||
    (a.contentDisposition && typeof a.contentDisposition === "object" && a.contentDisposition.params?.filename) ||
    "";
  const t = String(raw).trim();
  return t || `attachment-${index + 1}`;
}

/**
 * @param {unknown} att
 * @returns {string}
 */
function attachmentMimeType(att) {
  const a = att && typeof att === "object" ? att : {};
  const ct = a.contentType;
  if (typeof ct === "string" && ct.trim()) return ct.trim();
  if (ct && typeof ct === "object") {
    if (typeof ct.value === "string" && ct.value.trim()) return ct.value.trim();
    const t = ct.type;
    const st = ct.subtype;
    if (t && st) return `${String(t)}/${String(st)}`;
  }
  if (typeof a.type === "string" && a.type.trim()) return a.type.trim();
  return "application/octet-stream";
}

/**
 * @param {unknown} att
 * @returns {boolean}
 */
function attachmentIsInline(att) {
  const a = att && typeof att === "object" ? att : {};
  const cd = a.contentDisposition;
  if (cd === "inline") return true;
  if (cd && typeof cd === "object" && String(cd.value || "").toLowerCase() === "inline") return true;
  if (a.cid != null && String(a.cid).trim()) return true;
  return false;
}

/**
 * @param {unknown} att
 * @returns {string | null}
 */
function attachmentContentId(att) {
  const a = att && typeof att === "object" ? att : {};
  if (a.cid == null) return null;
  const s = String(a.cid).trim();
  return s.length ? s : null;
}

/**
 * @param {import('mailparser').ParsedMail | null | undefined} parsedMail
 * @returns {Array<{ fileName: string, mimeType: string, content: Buffer, size: number, contentId: string | null, isInline: boolean }>}
 */
export function extractAttachmentsFromParsedEmail(parsedMail) {
  const raw = parsedMail?.attachments;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  /** @type {Array<{ fileName: string, mimeType: string, content: Buffer, size: number, contentId: string | null, isInline: boolean }>} */
  const out = [];
  /** Dédup MIME / doublons dans le même parse (clé contenu). */
  const seenContentKeys = new Set();

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const content = a?.content;
    if (!Buffer.isBuffer(content) || content.length === 0) continue;

    const fileName = attachmentFileName(a, i);
    const mimeType = attachmentMimeType(a);
    const contentId = attachmentContentId(a);
    const isInline = attachmentIsInline(a);

    const quickKey = `${fileName}\0${content.length}\0${content.subarray(0, Math.min(64, content.length)).toString("hex")}`;
    if (seenContentKeys.has(quickKey)) continue;
    seenContentKeys.add(quickKey);

    out.push({
      fileName,
      mimeType,
      content,
      size: content.length,
      contentId,
      isInline,
    });
  }

  return out;
}

/**
 * @param {{ buffer: Buffer, fileName: string, organizationId: string }} p
 * @returns {Promise<{ storage_path: string }>}
 */
export async function storeAttachmentFile(p) {
  const { buffer, fileName, organizationId } = p;
  const { storage_path } = await uploadMailAttachmentFile(buffer, organizationId, fileName);
  return { storage_path };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   organizationId: string,
 *   fileName: string,
 *   mimeType: string,
 *   fileSize: number,
 *   storageKey: string,
 *   entityType: string,
 *   entityId: string,
 *   mailMessageId: string,
 *   contentSha256: string,
 *   isInline: boolean,
 * }} p
 * @returns {Promise<string>}
 */
export async function createDocumentFromAttachment(client, p) {
  const {
    organizationId,
    fileName,
    mimeType,
    fileSize,
    storageKey,
    entityType,
    entityId,
    mailMessageId,
    contentSha256,
    isInline,
  } = p;

  const bm = resolveSystemDocumentMetadata("mail_attachment", { fileName, displayName: fileName });
  const isClientVisible = entityType === "client" || entityType === "lead";

  const metadataJson = JSON.stringify({
    mail_message_id: mailMessageId,
    content_sha256: contentSha256,
    is_inline: isInline,
    source: "mail",
  });

  const ins = await client.query(
    `INSERT INTO entity_documents
     (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type, metadata_json,
      document_category, source_type, is_client_visible, display_name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10::jsonb, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      organizationId,
      entityType,
      entityId,
      fileName.length > 255 ? `${fileName.slice(0, 252)}...` : fileName,
      fileSize,
      mimeType.length > 100 ? mimeType.slice(0, 100) : mimeType,
      storageKey,
      "local",
      "mail_attachment",
      metadataJson,
      bm.document_category,
      bm.source_type,
      isClientVisible,
      bm.display_name,
      bm.description,
    ]
  );

  return ins.rows[0].id;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ attachmentId: string, documentId: string }} p
 */
export async function linkAttachmentToDocument(client, p) {
  await client.query(`UPDATE mail_attachments SET document_id = $2 WHERE id = $1`, [p.attachmentId, p.documentId]);
}

/**
 * Résout l’entité CRM pour entity_documents (client / lead prioritaire, sinon dossier org).
 * @param {import('pg').PoolClient} client
 * @param {string} messageId
 * @param {string} organizationId
 */
export async function resolveEntityForMailAttachment(client, messageId, organizationId) {
  const r = await client.query(
    `SELECT client_id, lead_id FROM mail_messages WHERE id = $1 AND organization_id = $2`,
    [messageId, organizationId]
  );
  const row = r.rows[0];
  if (!row) {
    return { entityType: "organization", entityId: organizationId };
  }
  if (row.client_id) {
    return { entityType: "client", entityId: row.client_id };
  }
  if (row.lead_id) {
    return { entityType: "lead", entityId: row.lead_id };
  }
  return { entityType: "organization", entityId: organizationId };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   messageId: string,
 *   organizationId: string,
 *   items: Array<{ fileName: string, mimeType: string, content: Buffer, size: number, contentId: string | null, isInline: boolean }>,
 * }} p
 * @returns {Promise<{ stored: number, skipped: number, skippedReasons: Record<string, number> }>}
 */
export async function processAttachmentItemsInTransaction(client, p) {
  const { messageId, organizationId, items } = p;
  let stored = 0;
  let skipped = 0;
  const skippedReasons = { too_large: 0, duplicate: 0, error: 0 };

  const seenShaInRun = new Set();

  const { entityType, entityId } = await resolveEntityForMailAttachment(client, messageId, organizationId);

  for (const item of items) {
    const buf = item.content;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      skipped += 1;
      skippedReasons.error += 1;
      continue;
    }
    if (buf.length > MAX_MAIL_ATTACHMENT_BYTES) {
      console.warn(
        `[mailAttachments] skip attachment too large (${buf.length} bytes) message=${messageId} file=${item.fileName}`
      );
      skipped += 1;
      skippedReasons.too_large += 1;
      continue;
    }

    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (seenShaInRun.has(sha256)) {
      skipped += 1;
      skippedReasons.duplicate += 1;
      continue;
    }
    seenShaInRun.add(sha256);

    const dupDb = await client.query(
      `SELECT id FROM mail_attachments WHERE mail_message_id = $1 AND content_sha256 = $2 LIMIT 1`,
      [messageId, sha256]
    );
    if (dupDb.rows.length > 0) {
      skipped += 1;
      skippedReasons.duplicate += 1;
      continue;
    }

    try {
      const { storage_path } = await storeAttachmentFile({
        buffer: buf,
        fileName: item.fileName,
        organizationId,
      });

      const documentId = await createDocumentFromAttachment(client, {
        organizationId,
        fileName: item.fileName,
        mimeType: item.mimeType || "application/octet-stream",
        fileSize: buf.length,
        storageKey: storage_path,
        entityType,
        entityId,
        mailMessageId: messageId,
        contentSha256: sha256,
        isInline: item.isInline === true,
      });

      const attIns = await client.query(
        `INSERT INTO mail_attachments (
          organization_id, mail_message_id, file_name, mime_type, size_bytes, storage_path,
          is_inline, content_id, document_id, content_sha256
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          organizationId,
          messageId,
          item.fileName,
          item.mimeType || "application/octet-stream",
          buf.length,
          storage_path,
          item.isInline === true,
          item.contentId,
          documentId,
          sha256,
        ]
      );

      if (!attIns.rows[0]?.id) {
        throw new Error("mail_attachments insert failed");
      }
      stored += 1;
    } catch (e) {
      console.error("[mailAttachments] pipeline error:", e?.message || e);
      skipped += 1;
      skippedReasons.error += 1;
    }
  }

  return { stored, skipped, skippedReasons };
}

/**
 * Pipeline IMAP / mailparser.
 * @param {{
 *   dbClient: import('pg').PoolClient,
 *   messageId: string,
 *   organizationId: string,
 *   parsedMail: import('mailparser').ParsedMail,
 * }} p
 */
export async function processAttachmentsForMessage(p) {
  const { dbClient, messageId, organizationId, parsedMail } = p;
  const items = extractAttachmentsFromParsedEmail(parsedMail);
  if (items.length === 0) {
    return { stored: 0, skipped: 0, skippedReasons: {} };
  }
  return processAttachmentItemsInTransaction(dbClient, { messageId, organizationId, items });
}

/**
 * Pipeline SMTP (buffers déjà lus).
 * @param {{
 *   dbClient: import('pg').PoolClient,
 *   messageId: string,
 *   organizationId: string,
 *   bufferItems: Array<{
 *     file_name: string,
 *     mime_type: string | null,
 *     buffer: Buffer,
 *     is_inline?: boolean,
 *     content_id?: string | null,
 *   }>,
 * }} p
 */
export async function processAttachmentsFromBufferRows(p) {
  const { dbClient, messageId, organizationId, bufferItems } = p;
  if (!bufferItems?.length) {
    return { stored: 0, skipped: 0, skippedReasons: {} };
  }
  const items = bufferItems.map((row, i) => ({
    fileName: row.file_name || `attachment-${i + 1}`,
    mimeType: row.mime_type || "application/octet-stream",
    content: row.buffer,
    size: row.buffer.length,
    contentId: row.content_id ?? null,
    isInline: row.is_inline === true,
  }));
  return processAttachmentItemsInTransaction(dbClient, { messageId, organizationId, items });
}
