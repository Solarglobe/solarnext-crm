/**
 * Worker for durable IMAP move/delete mutations.
 */

import {
  processMailMoveMutationBatch,
  reapStuckMoveMutations,
} from "../services/mail/mailMoveMutation.service.js";
import logger from "../app/core/logger.js";

const INTERVAL_MS = Math.max(Number(process.env.MAIL_MOVE_MUTATION_POLL_MS) || 5000, 2000);
const REAP_INTERVAL_MS = Math.max(Number(process.env.MAIL_MOVE_MUTATION_REAP_MS) || 60_000, 30_000);

export function startMailMoveMutationProcessor() {
  if (process.env.MAIL_MOVE_MUTATION_WORKER === "0") {
    logger.info(
      { evt: "MAIL_MOVE_MUTATION_WORKER_DISABLED" },
      "Worker mutations deplacements IMAP desactive (MAIL_MOVE_MUTATION_WORKER=0)"
    );
    return;
  }

  const tick = async () => {
    try {
      const summary = await processMailMoveMutationBatch();
      if (summary.processed > 0) {
        logger.info({ evt: "MAIL_MOVE_MUTATION_TICK_DONE", ...summary }, "Mutations deplacements IMAP traitees");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_MOVE_MUTATION_TICK_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };

  const reap = async () => {
    try {
      const summary = await reapStuckMoveMutations();
      if (summary.reaped > 0) {
        logger.warn({ evt: "MAIL_MOVE_MUTATION_REAPED", ...summary }, "Mutations deplacements IMAP bloquees reprises");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_MOVE_MUTATION_REAP_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };

  void tick();
  void reap();
  setInterval(tick, INTERVAL_MS);
  setInterval(reap, REAP_INTERVAL_MS);
}
