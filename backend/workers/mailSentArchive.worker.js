import { processMailSentArchiveBatch } from "../services/mail/mailSentArchive.processor.js";
import logger from "../app/core/logger.js";

const INTERVAL_MS = Math.max(Number(process.env.MAIL_SENT_ARCHIVE_POLL_MS) || 5000, 2000);

export function startMailSentArchiveProcessor() {
  if (process.env.MAIL_SENT_ARCHIVE_WORKER === "0") {
    logger.info({ evt: "MAIL_SENT_ARCHIVE_WORKER_DISABLED" }, "Worker Sent IMAP desactive");
    return;
  }
  const tick = async () => {
    try {
      await processMailSentArchiveBatch();
    } catch (e) {
      logger.error({ evt: "MAIL_SENT_ARCHIVE_TICK_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };
  logger.info({ evt: "MAIL_SENT_ARCHIVE_WORKER_STARTED", intervalMs: INTERVAL_MS }, "Worker Sent IMAP demarre");
  void tick();
  setInterval(tick, INTERVAL_MS);
}

