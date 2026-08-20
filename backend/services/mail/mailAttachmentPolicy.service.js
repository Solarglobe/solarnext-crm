import path from "path";

export const OUTBOUND_ATTACHMENT_LIMITS = Object.freeze({
  perFileBytes: Math.min(Math.max(Number(process.env.MAIL_OUTBOUND_ATTACHMENT_MAX_BYTES) || 20 * 1024 * 1024, 1), 100 * 1024 * 1024),
  totalBytes: Math.min(Math.max(Number(process.env.MAIL_OUTBOUND_ATTACHMENTS_TOTAL_MAX_BYTES) || 35 * 1024 * 1024, 1), 200 * 1024 * 1024),
  maxFiles: Math.min(Math.max(Number(process.env.MAIL_OUTBOUND_ATTACHMENTS_MAX_FILES) || 25, 1), 100),
});

export function sanitizeAttachmentFileName(raw, fallback = "attachment") {
  const base = path.basename(String(raw || "").replace(/\0/g, "")).trim();
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned.slice(0, 255);
}

export function assertNoPathTraversal(filename) {
  const raw = String(filename || "");
  if (raw.includes("..") || raw.includes("/") || raw.includes("\\") || path.basename(raw) !== raw) {
    const err = new Error("Nom de piece jointe refuse");
    err.code = "MAIL_ATTACHMENT_PATH_TRAVERSAL";
    throw err;
  }
}

export function validateOutboundAttachmentBatch(items, limits = OUTBOUND_ATTACHMENT_LIMITS) {
  if ((items || []).length > limits.maxFiles) {
    const err = new Error("Nombre de pieces jointes trop eleve");
    err.code = "MAIL_ATTACHMENT_COUNT_TOO_HIGH";
    throw err;
  }
  let total = 0;
  const normalized = [];
  for (const item of items || []) {
    const filename = sanitizeAttachmentFileName(item.filename || item.file_name);
    assertNoPathTraversal(filename);
    const size = Number(item.sizeBytes ?? item.size_bytes ?? item.size ?? 0);
    if (!Number.isFinite(size) || size < 0) {
      const err = new Error("Taille de piece jointe invalide");
      err.code = "MAIL_ATTACHMENT_SIZE_INVALID";
      throw err;
    }
    if (size > limits.perFileBytes) {
      const err = new Error("Piece jointe trop volumineuse");
      err.code = "MAIL_ATTACHMENT_FILE_TOO_LARGE";
      throw err;
    }
    total += size;
    if (total > limits.totalBytes) {
      const err = new Error("Total des pieces jointes trop volumineux");
      err.code = "MAIL_ATTACHMENT_TOTAL_TOO_LARGE";
      throw err;
    }
    normalized.push({ ...item, filename, sizeBytes: size });
  }
  return normalized;
}
