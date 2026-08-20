import fs from "fs/promises";
import { createHash } from "crypto";
import { pool } from "../../config/db.js";
import { getAbsolutePath, uploadMailAttachmentFile, deleteFile } from "../localStorage.service.js";
import { OUTBOUND_ATTACHMENT_LIMITS, sanitizeAttachmentFileName, validateOutboundAttachmentBatch } from "./mailAttachmentPolicy.service.js";
import { MAIL_ATTACHMENT_SCAN_STATUSES, scanMailAttachmentBuffer } from "./mailAttachmentScan.service.js";

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function ensureDraftAccess(client, { organizationId, userId, draftId }) {
  const r = await client.query(
    `SELECT id, mail_account_id FROM mail_drafts
      WHERE id = $1 AND organization_id = $2 AND user_id = $3
      FOR UPDATE`,
    [draftId, organizationId, userId]
  );
  return r.rows[0] || null;
}

export async function attachUploadedFileToDraft({ organizationId, userId, draftId, file }) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    const err = new Error("Upload interrompu ou fichier manquant");
    err.statusCode = 400;
    throw err;
  }
  const normalized = validateOutboundAttachmentBatch([
    { filename: file.originalname || "attachment", size: file.buffer.length },
  ])[0];
  const fileName = sanitizeAttachmentFileName(normalized.filename);
  const scan = await scanMailAttachmentBuffer({
    buffer: file.buffer,
    filename: fileName,
    mimeType: file.mimetype || "application/octet-stream",
  });
  const client = await pool.connect();
  let storagePath = null;
  try {
    await client.query("BEGIN");
    const draft = await ensureDraftAccess(client, { organizationId, userId, draftId });
    if (!draft) {
      const err = new Error("Brouillon introuvable");
      err.statusCode = 404;
      throw err;
    }
    const stored = await uploadMailAttachmentFile(file.buffer, organizationId, fileName);
    storagePath = stored.storage_path;
    const sha = sha256Buffer(file.buffer);
    const ins = await client.query(
      `INSERT INTO mail_draft_attachments (
         organization_id, user_id, mail_account_id, draft_id, file_name, storage_path,
         mime_type, size_bytes, content_sha256, upload_status,
         scan_status, scan_checked_at, scan_provider, scan_error_code, quarantine_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'uploaded', $10, now(), $11, $12, $13)
       ON CONFLICT (draft_id, content_sha256) WHERE draft_id IS NOT NULL AND cleanup_status <> 'deleted'
       DO UPDATE SET updated_at = now(), cleanup_status = 'referenced',
         scan_status = EXCLUDED.scan_status,
         scan_checked_at = EXCLUDED.scan_checked_at,
         scan_provider = EXCLUDED.scan_provider,
         scan_error_code = EXCLUDED.scan_error_code,
         quarantine_reason = EXCLUDED.quarantine_reason
       RETURNING *`,
      [
        organizationId,
        userId,
        draft.mail_account_id,
        draftId,
        fileName,
        storagePath,
        file.mimetype || "application/octet-stream",
        file.buffer.length,
        sha,
        scan.status,
        scan.provider,
        scan.errorCode,
        scan.quarantineReason,
      ]
    );
    await client.query("COMMIT");
    return rowToDraftAttachment(ins.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    if (storagePath) await deleteFile(storagePath).catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function rowToDraftAttachment(row) {
  return {
    id: row.id,
    draftId: row.draft_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    contentSha256: row.content_sha256,
    uploadStatus: row.upload_status,
    scanStatus: row.scan_status || MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
    scanErrorCode: row.scan_error_code || null,
    quarantineReason: row.quarantine_reason || null,
    isInline: row.is_inline === true,
    contentId: row.content_id,
    createdAt: row.created_at,
  };
}

export async function listDraftAttachments({ organizationId, userId, draftId }) {
  const r = await pool.query(
    `SELECT a.* FROM mail_draft_attachments a
      JOIN mail_drafts d ON d.id = a.draft_id AND d.organization_id = a.organization_id
     WHERE a.organization_id = $1 AND a.draft_id = $2 AND d.user_id = $3
       AND a.cleanup_status <> 'deleted'
     ORDER BY a.created_at ASC`,
    [organizationId, draftId, userId]
  );
  return r.rows.map(rowToDraftAttachment);
}

export async function loadDraftAttachmentBuffers({ organizationId, draftId, expectedUserId = null }) {
  const params = [organizationId, draftId];
  let userClause = "";
  if (expectedUserId) {
    params.push(expectedUserId);
    userClause = ` AND d.user_id = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT a.* FROM mail_draft_attachments a
      JOIN mail_drafts d ON d.id = a.draft_id AND d.organization_id = a.organization_id
     WHERE a.organization_id = $1 AND a.draft_id = $2 ${userClause}
       AND a.cleanup_status <> 'deleted'
       AND a.upload_status = 'uploaded'
       AND a.scan_status = 'CLEAN'
     ORDER BY a.created_at ASC`,
    params
  );
  const out = [];
  let totalBytes = 0;
  for (const row of r.rows) {
    const abs = getAbsolutePath(row.storage_path);
    let buf;
    try {
      const st = await fs.stat(abs);
      const expectedSize = Number(row.size_bytes || st.size);
      totalBytes += expectedSize;
      if (expectedSize > OUTBOUND_ATTACHMENT_LIMITS.perFileBytes || totalBytes > OUTBOUND_ATTACHMENT_LIMITS.totalBytes) {
        const err = new Error(`Piece jointe trop volumineuse: ${row.file_name}`);
        err.code = "MAIL_DRAFT_ATTACHMENT_TOO_LARGE";
        throw err;
      }
      buf = await fs.readFile(abs);
    } catch (e) {
      if (e?.code === "MAIL_DRAFT_ATTACHMENT_TOO_LARGE") throw e;
      const err = new Error(`Pièce jointe manquante: ${row.file_name}`);
      err.code = "MAIL_DRAFT_ATTACHMENT_MISSING";
      throw err;
    }
    const sha = sha256Buffer(buf);
    if (sha !== row.content_sha256 || buf.length !== Number(row.size_bytes)) {
      const err = new Error(`Pièce jointe modifiée après upload: ${row.file_name}`);
      err.code = "MAIL_DRAFT_ATTACHMENT_INTEGRITY";
      throw err;
    }
    out.push({
      id: row.id,
      filename: row.file_name,
      file_name: row.file_name,
      contentType: row.mime_type || "application/octet-stream",
      mime_type: row.mime_type || "application/octet-stream",
      sizeBytes: Number(row.size_bytes),
      contentSha256: row.content_sha256,
      content: buf,
      buffer: buf,
      is_inline: row.is_inline === true,
      content_id: row.content_id,
    });
  }
  return out;
}

export async function deleteDraftAttachment({ organizationId, userId, draftId, attachmentId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE mail_draft_attachments a SET cleanup_status = 'orphaned', updated_at = now()
        FROM mail_drafts d
       WHERE a.id = $1 AND a.organization_id = $2 AND a.draft_id = $3
         AND d.id = a.draft_id AND d.organization_id = a.organization_id AND d.user_id = $4
       RETURNING a.storage_path`,
      [attachmentId, organizationId, draftId, userId]
    );
    await client.query("COMMIT");
    return r.rowCount > 0;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getDraftAttachmentForDownload({ organizationId, userId, draftId, attachmentId }) {
  const r = await pool.query(
    `SELECT a.* FROM mail_draft_attachments a
      JOIN mail_drafts d ON d.id = a.draft_id AND d.organization_id = a.organization_id
     WHERE a.id = $1 AND a.organization_id = $2 AND a.draft_id = $3
       AND d.user_id = $4 AND a.cleanup_status <> 'deleted'`,
    [attachmentId, organizationId, draftId, userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.scan_status !== MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN) {
    const err = new Error("Piece jointe non validee par le scan de securite");
    err.code = "MAIL_ATTACHMENT_SCAN_REQUIRED";
    err.statusCode = 423;
    throw err;
  }
  return {
    path: getAbsolutePath(row.storage_path),
    fileName: row.file_name,
    mimeType: row.mime_type || "application/octet-stream",
    sizeBytes: Number(row.size_bytes),
  };
}

export async function cleanupOrphanedDraftAttachments() {
  const r = await pool.query(
    `SELECT id, storage_path FROM mail_draft_attachments
      WHERE cleanup_status = 'orphaned'
        AND updated_at < now() - interval '10 minutes'
      LIMIT 50`
  );
  let deleted = 0;
  for (const row of r.rows) {
    await deleteFile(row.storage_path).catch(() => {});
    await pool.query(`UPDATE mail_draft_attachments SET cleanup_status = 'deleted', updated_at = now() WHERE id = $1`, [row.id]);
    deleted += 1;
  }
  return { deleted };
}
