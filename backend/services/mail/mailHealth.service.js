import { pool } from "../../config/db.js";
import {
  checkMailAttachmentScannerHealth,
  getMailAttachmentScanConfig,
  getMailAttachmentScanMetrics,
} from "./mailAttachmentScan.service.js";

async function scalar(sql, params) {
  const r = await pool.query(sql, params);
  return Number(r.rows[0]?.value || 0);
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

  const queues = {
    outboxDepth: await scalar(`SELECT count(*)::int AS value FROM mail_outbox WHERE organization_id = $1 AND status IN ('queued','retrying','sending')`, params),
    outboxOldestAgeSeconds: await scalar(`SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::int AS value FROM mail_outbox WHERE organization_id = $1 AND status IN ('queued','retrying','sending')`, params),
    draftJobsDepth: await scalar(`SELECT count(*)::int AS value FROM mail_draft_sync_jobs WHERE organization_id = $1 AND status IN ('queued','retrying','processing')`, params),
    sentArchivePending: await scalar(`SELECT count(*)::int AS value FROM mail_outbox WHERE organization_id = $1 AND sent_archive_status IN ('pending','retrying')`, params),
    flagJobsDepth: await scalar(`SELECT count(*)::int AS value FROM mail_flag_mutation_jobs WHERE organization_id = $1 AND status IN ('queued','retrying','processing')`, params),
    moveJobsDepth: await scalar(`SELECT count(*)::int AS value FROM mail_move_mutation_jobs WHERE organization_id = $1 AND status IN ('queued','retrying','processing')`, params),
    scanPending: await scalar(`SELECT count(*)::int AS value FROM mail_attachments WHERE organization_id = $1 AND scan_status IN ('PENDING','SCANNING','UNAVAILABLE','FAILED')`, params),
    scanInfected: await scalar(`SELECT count(*)::int AS value FROM mail_attachments WHERE organization_id = $1 AND scan_status = 'INFECTED'`, params),
    draftScanPending: await scalar(`SELECT count(*)::int AS value FROM mail_draft_attachments WHERE organization_id = $1 AND scan_status IN ('PENDING','SCANNING','UNAVAILABLE','FAILED')`, params),
    draftConflicts: await scalar(`SELECT count(*)::int AS value FROM mail_drafts WHERE organization_id = $1 AND sync_status = 'conflict'`, params),
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
    scanner: {
      ...scanner,
      required: scannerConfig.scanMode === "required",
      degraded: scannerConfig.scanMode === "required" && scanner.ok !== true,
      metrics: getMailAttachmentScanMetrics(),
    },
  };
}
