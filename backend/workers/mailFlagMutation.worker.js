/**
 * Worker for durable IMAP read/unread flag mutations.
 */

import {
  processMailFlagMutationBatch,
  reapStuckFlagMutations,
} from "../services/mail/mailFlagMutation.service.js";
import logger from "../app/core/logger.js";

const INTERVAL_MS = Math.max(Number(process.env.MAIL_FLAG_MUTATION_POLL_MS) || 5000, 2000);
const REAP_INTERVAL_MS = Math.max(Number(process.env.MAIL_FLAG_MUTATION_REAP_MS) || 60_000, 30_000);

export function startMailFlagMutationProcessor() {
  if (process.env.MAIL_FLAG_MUTATION_WORKER === "0") {
    logger.info(
      { evt: "MAIL_FLAG_MUTATION_WORKER_DISABLED" },
      "Worker mutations flags IMAP desactive (MAIL_FLAG_MUTATION_WORKER=0)"
    );
    return;
  }

  const tick = async () => {
    try {
      const summary = await processMailFlagMutationBatch();
      if (summary.processed > 0) {
        logger.info({ evt: "MAIL_FLAG_MUTATION_TICK_DONE", ...summary }, "Mutations flags IMAP traitees");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_FLAG_MUTATION_TICK_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };

  const reap = async () => {
    try {
      const summary = await reapStuckFlagMutations();
      if (summary.reaped > 0) {
        logger.warn({ evt: "MAIL_FLAG_MUTATION_REAPED", ...summary }, "Mutations flags IMAP bloquees reprises");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_FLAG_MUTATION_REAP_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };

  void tick();
  void reap();
  setInterval(tick, INTERVAL_MS);
  setInterval(reap, REAP_INTERVAL_MS);
}
