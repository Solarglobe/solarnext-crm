import { createHash } from "crypto";
import fs from "fs/promises";
import { uploadMailAttachmentFile, deleteFile, getAbsolutePath } from "../localStorage.service.js";
import { sanitizeAttachmentFileName, validateOutboundAttachmentBatch } from "./mailAttachmentPolicy.service.js";
import { scanMailAttachmentBuffer } from "./mailAttachmentScan.service.js";

const defaults = { upload: uploadMailAttachmentFile, remove: deleteFile, scan: scanMailAttachmentBuffer,
  readBuffer: storagePath => fs.readFile(getAbsolutePath(storagePath)) };
const sha256 = (content) => createHash("sha256").update(content).digest("hex");

function attachmentManifest(row, draftId = row.draft_id) {
  return {
    id: row.id, draftId, fileName: row.file_name, mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes), contentSha256: row.content_sha256,
    uploadStatus: row.upload_status, scanStatus: row.scan_status,
    isInline: row.is_inline === true, contentId: row.content_id || null,
  };
}

function normalizeRemoteAttachments(attachments) {
  const unique = new Map();
  const parts = (attachments || []).map((part, index) => {
    if (!Buffer.isBuffer(part?.content)) {
      throw Object.assign(new Error("Pièce jointe distante sans contenu binaire : import interrompu."), { code: "MAIL_DRAFT_REMOTE_ATTACHMENT_CONTENT" });
    }
    const contentId = String(part.cid || part.contentId || "").trim().replace(/^<|>$/g, "").trim() || null;
    const disposition = String(part.contentDisposition || "").toLowerCase();
    return {
      filename: sanitizeAttachmentFileName(part.filename || `attachment-${index + 1}`),
      mimeType: part.contentType || "application/octet-stream", content: part.content,
      sizeBytes: part.content.length, contentSha256: sha256(part.content), contentId,
      isInline: disposition === "inline" || (!disposition && part.related === true),
    };
  });
  validateOutboundAttachmentBatch(parts);
  for (const part of parts) {
    const previous = unique.get(part.contentSha256);
    if (previous && (previous.filename !== part.filename || previous.mimeType !== part.mimeType || previous.contentId !== part.contentId || previous.isInline !== part.isInline)) {
      // Existing schema identifies one attachment per draft+SHA. Never silently lose a distinct MIME part.
      throw Object.assign(new Error("Deux pièces jointes ont le même contenu mais des noms ou références MIME différents. Import conservé à distance, non terminé."), { code: "MAIL_DRAFT_REMOTE_ATTACHMENT_DUPLICATE_CONTENT_METADATA" });
    }
    if (!previous) unique.set(part.contentSha256, part);
  }
  return [...unique.values()];
}

/** Only deletes paths created by this import, after rollback, and only when no row references them. */
export async function cleanupCreatedRemoteDraftAttachmentFiles(client, createdPaths, dependencies = {}) {
  const { remove } = { ...defaults, ...dependencies };
  const failures = [];
  for (const storagePath of new Set(createdPaths)) {
    try {
      const references = await client.query(
        `/* remote-draft-attachments:references */ SELECT id FROM mail_draft_attachments WHERE storage_path = $1 LIMIT 1`,
        [storagePath]
      );
      if (references.rows.length === 0) await remove(storagePath);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Nettoyage des nouveaux fichiers du brouillon non confirmé.");
}

/** Caller holds the draft row in its transaction. No pool, transaction commit, or general purge here. */
export async function persistRemoteDraftAttachments(client, p, dependencies = {}, createdPaths = []) {
  const { upload, scan, readBuffer } = { ...defaults, ...dependencies };
  const parts = normalizeRemoteAttachments(p.attachments);
  const existing = await client.query(
    `/* remote-draft-attachments:list */ SELECT * FROM mail_draft_attachments
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND draft_id = $4
       AND cleanup_status <> 'deleted' FOR UPDATE`,
    [p.organizationId, p.userId, p.mailAccountId, p.draftId]
  );
  const byHash = new Map(existing.rows.map(row => [row.content_sha256, row]));
  const manifest = [];
  for (const part of parts) {
    const previous = byHash.get(part.contentSha256);
    let storagePath = previous?.upload_status === "uploaded" ? previous.storage_path : null;
    if (storagePath) {
      try {
        const stored = await readBuffer(storagePath);
        if (!Buffer.isBuffer(stored) || stored.length !== part.sizeBytes || sha256(stored) !== part.contentSha256) storagePath = null;
      } catch { storagePath = null; }
    }
    let scanResult = previous && { status: previous.scan_status, provider: previous.scan_provider, errorCode: previous.scan_error_code, quarantineReason: previous.quarantine_reason };
    if (!storagePath || previous.file_name !== part.filename || previous.mime_type !== part.mimeType) {
      scanResult = await scan({ buffer: part.content, filename: part.filename, mimeType: part.mimeType });
    }
    if (!storagePath) {
      const stored = await upload(part.content, p.organizationId, part.filename);
      if (!stored?.storage_path) throw Object.assign(new Error("Stockage de la pièce jointe non confirmé."), { code: "MAIL_DRAFT_REMOTE_ATTACHMENT_STORAGE" });
      storagePath = stored.storage_path;
      createdPaths.push(storagePath);
    }
    const inserted = await client.query(
      `/* remote-draft-attachments:upsert */ INSERT INTO mail_draft_attachments (
        organization_id, user_id, mail_account_id, draft_id, file_name, storage_path,
        mime_type, size_bytes, content_sha256, upload_status, is_inline, content_id,
        scan_status, scan_checked_at, scan_provider, scan_error_code, quarantine_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploaded',$10,$11,$12,now(),$13,$14,$15)
       ON CONFLICT (draft_id, content_sha256) WHERE draft_id IS NOT NULL AND cleanup_status <> 'deleted'
       DO UPDATE SET file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type,
         storage_path = EXCLUDED.storage_path, size_bytes = EXCLUDED.size_bytes,
         is_inline = EXCLUDED.is_inline, content_id = EXCLUDED.content_id,
         upload_status = EXCLUDED.upload_status, cleanup_status = 'referenced',
         scan_status = EXCLUDED.scan_status, scan_checked_at = EXCLUDED.scan_checked_at,
         scan_provider = EXCLUDED.scan_provider, scan_error_code = EXCLUDED.scan_error_code,
         quarantine_reason = EXCLUDED.quarantine_reason, updated_at = now()
       RETURNING *`,
      [p.organizationId, p.userId, p.mailAccountId, p.draftId, part.filename, storagePath, part.mimeType,
        part.sizeBytes, part.contentSha256, part.isInline, part.contentId,
        scanResult?.status || "UNAVAILABLE", scanResult?.provider || null, scanResult?.errorCode || null, scanResult?.quarantineReason || null]
    );
    if (!inserted.rows[0]) throw new Error("Association de la pièce jointe au brouillon non confirmée.");
    manifest.push(attachmentManifest(inserted.rows[0]));
  }
  // Detached files are retained for the existing deferred orphan cleanup. They cannot be resent with this draft.
  await client.query(
    `/* remote-draft-attachments:detach */ UPDATE mail_draft_attachments SET draft_id = NULL, cleanup_status = 'orphaned', updated_at = now()
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND draft_id = $4
       AND cleanup_status <> 'deleted' AND NOT (id = ANY($5::uuid[]))`,
    [p.organizationId, p.userId, p.mailAccountId, p.draftId, manifest.map(item => item.id)]
  );
  await client.query(
    `/* remote-draft-attachments:manifest */ UPDATE mail_drafts SET attachments_json = $5::jsonb
     WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND mail_account_id = $4`,
    [p.draftId, p.organizationId, p.userId, p.mailAccountId, JSON.stringify(manifest)]
  );
  return manifest;
}

/** Called while resolving a conflict under the target draft lock. Only moves references, never files. */
export async function adoptRemoteDraftAttachments(client, p) {
  if (p.sourceDraftId === p.targetDraftId) throw new Error("Source de conflit identique au brouillon cible.");
  const drafts = await client.query(
    `/* remote-draft-attachments:adoption-drafts */ SELECT id, draft_identity, conflict_of_draft_id FROM mail_drafts
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND id = ANY($4::uuid[])
     ORDER BY id FOR UPDATE`,
    [p.organizationId, p.userId, p.mailAccountId, [p.sourceDraftId, p.targetDraftId]]
  );
  const source = drafts.rows.find(row => row.id === p.sourceDraftId);
  const target = drafts.rows.find(row => row.id === p.targetDraftId);
  if (!source || !target || source.conflict_of_draft_id !== target.id || !target.draft_identity || !String(source.draft_identity || "").startsWith(`${target.draft_identity}-remote-`)) {
    throw Object.assign(new Error("La copie distante n'appartient plus à ce brouillon ou à ce compte."), { code: "MAIL_DRAFT_ATTACHMENT_SCOPE_CONFLICT", statusCode: 409 });
  }
  const attachments = await client.query(
    `/* remote-draft-attachments:list */ SELECT * FROM mail_draft_attachments
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND draft_id = $4
       AND cleanup_status <> 'deleted' FOR UPDATE`,
    [p.organizationId, p.userId, p.mailAccountId, p.sourceDraftId]
  );
  if (attachments.rows.some(row => !row.storage_path || row.upload_status !== "uploaded")) {
    throw Object.assign(new Error("Pièces jointes de la copie distante incomplètes."), { code: "MAIL_DRAFT_REMOTE_ATTACHMENT_STORAGE", statusCode: 409 });
  }
  await client.query(
    `/* remote-draft-attachments:adoption-detach */ UPDATE mail_draft_attachments SET draft_id = NULL, cleanup_status = 'orphaned', updated_at = now()
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND draft_id = $4 AND cleanup_status <> 'deleted'`,
    [p.organizationId, p.userId, p.mailAccountId, p.targetDraftId]
  );
  await client.query(
    `/* remote-draft-attachments:adoption-move */ UPDATE mail_draft_attachments SET draft_id = $5, cleanup_status = 'referenced', updated_at = now()
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND draft_id = $4 AND cleanup_status <> 'deleted'`,
    [p.organizationId, p.userId, p.mailAccountId, p.sourceDraftId, p.targetDraftId]
  );
  const manifest = attachments.rows.map(row => attachmentManifest(row, p.targetDraftId));
  await client.query(
    `/* remote-draft-attachments:adoption-manifest */ UPDATE mail_drafts SET attachments_json = CASE WHEN id = $4 THEN $6::jsonb ELSE '[]'::jsonb END
     WHERE organization_id = $1 AND user_id = $2 AND mail_account_id = $3 AND id = ANY($5::uuid[])`,
    [p.organizationId, p.userId, p.mailAccountId, p.targetDraftId, [p.sourceDraftId, p.targetDraftId], JSON.stringify(manifest)]
  );
  return manifest;
}
