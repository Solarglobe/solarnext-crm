import { processMailDraftSyncBatch, reapStuckDraftSyncJobs } from "../services/mail/mailDraftSync.processor.js";
import logger from "../app/core/logger.js";

const INTERVAL_MS = Math.max(Number(process.env.MAIL_DRAFT_SYNC_POLL_MS) || 5000, 2000);
const REAP_INTERVAL_MS = Math.max(Number(process.env.MAIL_DRAFT_SYNC_REAP_MS) || 5 * 60 * 1000, 60 * 1000);

export function startMailDraftSyncProcessor() {
  if (process.env.MAIL_DRAFT_SYNC_WORKER === "0") {
    logger.info({ evt: "MAIL_DRAFT_SYNC_WORKER_DISABLED" }, "Worker brouillons IMAP desactive");
    return;
  }
  const tick = async () => {
    try {
      await processMailDraftSyncBatch();
    } catch (e) {
      logger.error({ evt: "MAIL_DRAFT_SYNC_TICK_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };
  const reap = async () => {
    try {
      await reapStuckDraftSyncJobs();
    } catch (e) {
      logger.error({ evt: "MAIL_DRAFT_SYNC_REAP_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };
  logger.info({ evt: "MAIL_DRAFT_SYNC_WORKER_STARTED", intervalMs: INTERVAL_MS }, "Worker brouillons IMAP demarre");
  void tick();
  void reap();
  setInterval(tick, INTERVAL_MS);
  setInterval(reap, REAP_INTERVAL_MS);
}

