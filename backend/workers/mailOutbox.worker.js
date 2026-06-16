/**
 * Boucle de traitement de la file d’envoi (intervalle, optionnellement désactivable).
 */

import { processMailOutboxBatch, reapStuckSendingJobs } from "../services/mail/mailOutbox.processor.js";
import logger from "../app/core/logger.js";

const INTERVAL_MS = Math.max(Number(process.env.MAIL_OUTBOX_POLL_MS) || 5000, 2000);
/** Le reaper tourne moins souvent que la boucle d'envoi (défaut 5 min). */
const REAP_INTERVAL_MS = Math.max(Number(process.env.MAIL_OUTBOX_REAP_MS) || 5 * 60 * 1000, 60 * 1000);

export function startMailOutboxProcessor() {
  if (process.env.MAIL_OUTBOX_WORKER === "0") {
    logger.info({ evt: "MAIL_OUTBOX_WORKER_DISABLED" }, "Worker file d’envoi désactivé (MAIL_OUTBOX_WORKER=0)");
    return;
  }

  const tick = async () => {
    try {
      await processMailOutboxBatch();
    } catch (e) {
      logger.error({ evt: "MAIL_OUTBOX_TICK_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };

  const reap = async () => {
    try {
      await reapStuckSendingJobs();
    } catch (e) {
      logger.error({ evt: "MAIL_OUTBOX_REAP_ERR" }, e instanceof Error ? e.message : String(e));
    }
  };

  void tick();
  void reap(); // au démarrage : récupère les jobs laissés en 'sending' par un arrêt/crash précédent
  setInterval(tick, INTERVAL_MS);
  setInterval(reap, REAP_INTERVAL_MS);
}
