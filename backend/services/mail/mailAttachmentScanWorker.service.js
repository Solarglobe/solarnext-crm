import { pool } from "../../config/db.js";
import { getAbsolutePath, deleteFile } from "../localStorage.service.js";
import logger from "../../app/core/logger.js";
import {
  MAIL_ATTACHMENT_SCAN_STATUSES,
  scanMailAttachmentFile,
  getMailAttachmentScanConfig,
} from "./mailAttachmentScan.service.js";

const DEFAULT_BATCH = 8;
const MAX_ATTEMPTS = Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_MAX_ATTEMPTS || 6), 1), 20);
const STUCK_MINUTES = Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_STUCK_MINUTES || 10), 2), 120);

function delayMsAfterScanFailure(attempt) {
  return Math.min(5 * 60 * 1000, Math.max(1000, 1000 * 2 ** Math.min(Number(attempt) || 0, 8)));
}

function tableConfig(kind) {
  if (kind === "draft") {
    return {
      kind,
      table: "mail_draft_attachments",
      idSelect: "a.id, a.organization_id, a.file_name, a.mime_type, a.size_bytes, a.storage_path, a.scan_attempt_count",
      extraWhere: "cleanup_status <> 'deleted' AND upload_status = 'uploaded'",
    };
  }
  return {
    kind: "message",
    table: "mail_attachments",
    idSelect: "a.id, a.organization_id, a.file_name, a.mime_type, a.size_bytes, a.storage_path, a.scan_attempt_count",
    extraWhere: "storage_path IS NOT NULL",
  };
}

async function claimForTable(client, cfg, limit) {
  const r = await client.query(
    `WITH cte AS (
       SELECT id
       FROM ${cfg.table}
       WHERE scan_status IN ('PENDING','FAILED','UNAVAILABLE')
         AND scan_next_attempt_at <= now()
         AND scan_attempt_count < $1
         AND ${cfg.extraWhere}
       ORDER BY scan_next_attempt_at ASC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE ${cfg.table} a SET
       scan_status = 'SCANNING',
       scan_locked_at = now(),
       scan_attempt_count = scan_attempt_count + 1,
       updated_at = now()
     FROM cte
     WHERE a.id = cte.id
     RETURNING ${cfg.idSelect}`,
    [MAX_ATTEMPTS, limit]
  );
  return r.rows.map((row) => ({ ...row, kind: cfg.kind, table: cfg.table }));
}

export async function claimMailAttachmentScanJobs({ limit = DEFAULT_BATCH } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const messageJobs = await claimForTable(client, tableConfig("message"), Math.max(1, limit));
    const remaining = Math.max(0, limit - messageJobs.length);
    const draftJobs = remaining > 0 ? await claimForTable(client, tableConfig("draft"), remaining) : [];
    await client.query("COMMIT");
    return [...messageJobs, ...draftJobs];
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function markScanned(job, scan) {
  await pool.query(
    `UPDATE ${job.table} SET
       scan_status = $2::mail_attachment_scan_status,
       scan_checked_at = now(),
       scan_locked_at = NULL,
       scan_provider = $3,
       scan_error_code = $4,
       quarantine_reason = $5,
       scan_next_attempt_at = CASE
         WHEN $2::mail_attachment_scan_status IN ('CLEAN','INFECTED') THEN scan_next_attempt_at
         ELSE now() + ($6::integer * interval '1 millisecond')
       END,
       updated_at = now()
     WHERE id = $1 AND organization_id = $7`,
    [
      job.id,
      scan.status,
      scan.provider || null,
      scan.errorCode || null,
      scan.quarantineReason || null,
      delayMsAfterScanFailure(job.scan_attempt_count),
      job.organization_id,
    ]
  );
}

async function markScanFailure(job, err) {
  const attempts = Number(job.scan_attempt_count || 0);
  const exhausted = attempts >= MAX_ATTEMPTS;
  await pool.query(
    `UPDATE ${job.table} SET
       scan_status = $2::mail_attachment_scan_status,
       scan_checked_at = now(),
       scan_locked_at = NULL,
       scan_error_code = $3,
       quarantine_reason = $4,
       scan_next_attempt_at = now() + ($5::integer * interval '1 millisecond'),
       updated_at = now()
     WHERE id = $1 AND organization_id = $6`,
    [
      job.id,
      exhausted ? MAIL_ATTACHMENT_SCAN_STATUSES.FAILED : MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
      err?.code || "SCAN_WORKER_ERROR",
      exhausted ? "scan_failed" : "scanner_unavailable",
      delayMsAfterScanFailure(attempts),
      job.organization_id,
    ]
  );
}

export async function processMailAttachmentScanJob(job) {
  if (!job?.storage_path) {
    const err = new Error("Fichier de pièce jointe introuvable");
    err.code = "MAIL_ATTACHMENT_STORAGE_PATH_MISSING";
    throw err;
  }
  try {
    const abs = getAbsolutePath(job.storage_path);
    const scan = await scanMailAttachmentFile({
      path: abs,
      sizeBytes: Number(job.size_bytes || 0),
      filename: job.file_name || "attachment",
      mimeType: job.mime_type || "application/octet-stream",
      config: getMailAttachmentScanConfig(),
    });
    await markScanned(job, scan);
    if (scan.status === MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED && process.env.MAIL_ATTACHMENT_SCAN_DELETE_INFECTED === "1") {
      await deleteFile(job.storage_path).catch(() => {});
    }
    return { id: job.id, kind: job.kind, status: scan.status };
  } catch (e) {
    await markScanFailure(job, e);
    logger.warn({ evt: "MAIL_ATTACHMENT_SCAN_FAIL", attachmentId: job.id, kind: job.kind, code: e?.code }, e?.message || String(e));
    return { id: job.id, kind: job.kind, status: "error", code: e?.code || "SCAN_WORKER_ERROR" };
  }
}

export async function processMailAttachmentScanBatch({ limit = DEFAULT_BATCH } = {}) {
  const jobs = await claimMailAttachmentScanJobs({ limit });
  const concurrency = Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_CONCURRENCY || 2), 1), 8);
  const results = [];
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map((job) => processMailAttachmentScanJob(job))));
  }
  return { processed: jobs.length, results };
}

export async function reapStuckAttachmentScans(maxMinutes = STUCK_MINUTES) {
  const params = [maxMinutes, MAX_ATTEMPTS];
  const message = await pool.query(
    `UPDATE mail_attachments SET
       scan_status = CASE WHEN scan_attempt_count >= $2 THEN 'FAILED'::mail_attachment_scan_status ELSE 'UNAVAILABLE'::mail_attachment_scan_status END,
       scan_locked_at = NULL,
       scan_error_code = 'SCAN_WORKER_INTERRUPTED',
       quarantine_reason = 'worker_interrupted',
       scan_next_attempt_at = now(),
       updated_at = now()
     WHERE scan_status = 'SCANNING'
       AND scan_locked_at < now() - ($1 * interval '1 minute')
     RETURNING id`,
    params
  );
  const draft = await pool.query(
    `UPDATE mail_draft_attachments SET
       scan_status = CASE WHEN scan_attempt_count >= $2 THEN 'FAILED'::mail_attachment_scan_status ELSE 'UNAVAILABLE'::mail_attachment_scan_status END,
       scan_locked_at = NULL,
       scan_error_code = 'SCAN_WORKER_INTERRUPTED',
       quarantine_reason = 'worker_interrupted',
       scan_next_attempt_at = now(),
       updated_at = now()
     WHERE scan_status = 'SCANNING'
       AND scan_locked_at < now() - ($1 * interval '1 minute')
     RETURNING id`,
    params
  );
  return { reaped: message.rowCount + draft.rowCount };
}
