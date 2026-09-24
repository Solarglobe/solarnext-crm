import { pool } from "../../config/db.js";
import {
  checkMailAttachmentScannerHealth,
  getMailAttachmentScanConfig,
  getMailAttachmentScanMetrics,
  MAIL_ATTACHMENT_SCAN_MAX_ATTEMPTS,
} from "./mailAttachmentScan.service.js";

async function scalar(sql, params) {
  const r = await pool.query(sql, params);
  return Number(r.rows[0]?.value || 0);
}

async function scanCounts(organizationId, draft = false) {
  const table = draft ? "mail_draft_attachments" : "mail_attachments";
  const result = await pool.query(`SELECT category, count(*)::int AS value FROM (
    SELECT CASE
      WHEN scan_status = 'CLEAN' THEN 'clean'
      WHEN scan_status = 'INFECTED' THEN 'infected'
      WHEN scan_status = 'SCANNING' THEN 'scanning'
      WHEN scan_status IN ('PENDING','FAILED','UNAVAILABLE') AND scan_attempt_count >= $2 THEN 'exhausted'
      WHEN scan_status = 'UNAVAILABLE' THEN 'unavailable'
      WHEN scan_status = 'FAILED' AND scan_next_attempt_at IS NOT NULL
        ${draft ? "" : "AND storage_path IS NOT NULL"} THEN 'retryScheduled'
      WHEN scan_status = 'FAILED' THEN 'failedUnscheduled'
      WHEN scan_status = 'PENDING' THEN 'pending'
      ELSE 'unknown' END AS category
    FROM ${table} WHERE organization_id = $1
      ${draft ? "AND cleanup_status <> 'deleted' AND upload_status = 'uploaded'" : ""}
    ) scans GROUP BY category`, [organizationId, MAIL_ATTACHMENT_SCAN_MAX_ATTEMPTS]);
  const counts = { pending: 0, scanning: 0, retryScheduled: 0, exhausted: 0, unavailable: 0,
    clean: 0, infected: 0, failedUnscheduled: 0, unknown: 0, total: 0 };
  for (const row of result.rows) {
    counts[row.category] = Number(row.value);
    counts.total += Number(row.value);
  }
  return counts;
}

async function jobCounts(organizationId, archive = false) {
  const table = archive ? "mail_outbox" : "mail_draft_sync_jobs";
  const column = archive ? "sent_archive_status" : "status";
  const result = await pool.query(`SELECT ${column} AS status, count(*)::int AS value
    FROM ${table} WHERE organization_id = $1 GROUP BY ${column}`, [organizationId]);
  const counts = { queued: 0, retrying: 0, running: 0, completed: 0, failed: 0, notStarted: 0, unknown: 0 };
  const mapping = archive
    ? { pending: 'queued', retrying: 'retrying', running: 'running', done: 'completed', failed: 'failed', not_started: 'notStarted' }
    : { queued: 'queued', retrying: 'retrying', running: 'running', succeeded: 'completed', failed: 'failed' };
  for (const row of result.rows) counts[mapping[row.status] || 'unknown'] += Number(row.value);
  return counts;
}

export async function getMailHealthOverview({ organizationId }) {
  const params = [organizationId];
  const scannerConfig = getMailAttachmentScanConfig();
  const scanner = await checkMailAttachmentScannerHealth().catch((e) => ({
    ok: false,
    mode: scannerConfig.scanMode,
    provider: scannerConfig.scanner || "none",
    errorCode: e?.code || "SCANNER_HEALTH_ERROR",
  }));
  const accounts = await pool.query(
    `SELECT id, email, display_name, lifecycle_state, imap_status, smtp_status,
            last_successful_sync_at, next_sync_attempt_at, last_error_code, last_error_message,
            reconnect_required
     FROM mail_accounts
     WHERE organization_id = $1
     ORDER BY email ASC`,
    params
  );

  const scans = { messages: await scanCounts(organizationId), drafts: await scanCounts(organizationId, true), maxAttempts: MAIL_ATTACHMENT_SCAN_MAX_ATTEMPTS };
  const jobs = { drafts: await jobCounts(organizationId), sentArchive: await jobCounts(organizationId, true) };
  const queues = {
    outboxDepth: await scalar(`SELECT count(*)::int AS value FROM mail_outbox WHERE organization_id = $1 AND status IN ('queued','retrying','sending')`, params),
    outboxOldestAgeSeconds: await scalar(`SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::int AS value FROM mail_outbox WHERE organization_id = $1 AND status IN ('queued','retrying','sending')`, params),
    draftJobsDepth: jobs.drafts.queued + jobs.drafts.retrying + jobs.drafts.running,
    sentArchivePending: jobs.sentArchive.queued + jobs.sentArchive.retrying,
    flagJobsDepth: await scalar(`SELECT count(*)::int AS value FROM mail_flag_mutations WHERE organization_id = $1 AND status IN ('PENDING','RETRYING','PROCESSING')`, params),
    moveJobsDepth: await scalar(`SELECT count(*)::int AS value FROM mail_move_mutations WHERE organization_id = $1 AND status IN ('PENDING','RETRYING','PROCESSING')`, params),
    scanPending: scans.messages.pending,
    scanInfected: scans.messages.infected,
    draftScanPending: scans.drafts.pending,
    draftConflicts: await scalar(`SELECT count(*)::int AS value FROM mail_drafts WHERE organization_id = $1 AND sync_status = 'CONFLICT'`, params),
  };

  return {
    generatedAt: new Date().toISOString(),
    accounts: accounts.rows.map((a) => ({
      id: a.id,
      email: a.email,
      displayName: a.display_name,
      lifecycle: a.lifecycle_state,
      imapStatus: a.imap_status,
      smtpStatus: a.smtp_status,
      lastSuccessfulSyncAt: a.last_successful_sync_at,
      nextSyncAttemptAt: a.next_sync_attempt_at,
      lastErrorCode: a.last_error_code,
      lastErrorMessage: a.last_error_message,
      reconnectRequired: a.reconnect_required === true,
    })),
    queues,
    scans,
    jobs,
    scanner: {
      ...scanner,
      availability: scanner.provider === 'disabled' || scannerConfig.scanMode === 'disabled' ? 'disabled'
        : scanner.errorCode === 'SCANNER_UNAVAILABLE' || scanner.ok === false ? 'unavailable'
          : scanner.ok === true ? 'available' : 'unknown',
      required: scannerConfig.scanMode === "required",
      degraded: scannerConfig.scanMode === "required" && scanner.ok !== true,
      metrics: getMailAttachmentScanMetrics(),
    },
  };
}
