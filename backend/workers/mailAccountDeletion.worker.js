/**
 * Worker de purge locale des comptes mail.
 */

import { processMailAccountDeletionJobs } from "../services/mail/mailAccountDeletion.service.js";
import logger from "../app/core/logger.js";

const INTERVAL_MS = Math.max(Number(process.env.MAIL_ACCOUNT_DELETION_POLL_MS) || 30_000, 10_000);

export function startMailAccountDeletionProcessor() {
  if (process.env.MAIL_ACCOUNT_DELETION_WORKER === "0") {
    logger.info({ evt: "MAIL_ACCOUNT_DELETION_WORKER_DISABLED" }, "Worker purge comptes mail desactive");
    return;
  }
  const tick = async () => {
    try {
      const r = await processMailAccountDeletionJobs();
      if (r.processed > 0) {
        logger.info({ evt: "MAIL_ACCOUNT_DELETION_DONE", processed: r.processed }, "Purge locale comptes mail traitee");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_ACCOUNT_DELETION_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };
  void tick();
  setInterval(tick, INTERVAL_MS);
}
