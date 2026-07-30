/**
 * Boucle de synchronisation IMAP.
 *
 * La reception mail est decouplee de l'envoi SMTP : sans cette boucle, les
 * messages entrants ne sont importes dans le CRM qu'apres un appel manuel a
 * /api/mail/sync/run ou au script scripts/run-mail-sync.js.
 */

import { syncAllMailAccounts } from "../services/mail/mailSync.service.js";
import logger from "../app/core/logger.js";

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

const INTERVAL_MS = Math.max(Number(process.env.MAIL_SYNC_POLL_MS) || DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
const LIMIT = Number.isFinite(Number(process.env.MAIL_SYNC_LIMIT))
  ? Math.max(Number(process.env.MAIL_SYNC_LIMIT), 1)
  : null;

let running = false;

export function startMailSyncScheduler() {
  if (process.env.MAIL_SYNC_WORKER === "0") {
    logger.info({ evt: "MAIL_SYNC_WORKER_DISABLED" }, "Worker synchro IMAP desactive (MAIL_SYNC_WORKER=0)");
    return;
  }

  const tick = async () => {
    if (running) {
      logger.warn({ evt: "MAIL_SYNC_SKIPPED_BUSY" }, "Sync IMAP deja en cours, tick ignore");
      return;
    }

    running = true;
    const startedAt = Date.now();
    try {
      const summary = await syncAllMailAccounts({ limit: LIMIT });
      logger.info(
        {
          evt: "MAIL_SYNC_TICK_DONE",
          total: summary.total,
          ok: summary.ok,
          failed: summary.failed,
          durationMs: Date.now() - startedAt,
        },
        "Synchronisation IMAP terminee"
      );
      if (summary.failed > 0) {
        logger.warn({ evt: "MAIL_SYNC_TICK_PARTIAL", errors: summary.errors }, "Sync IMAP partielle");
      }
    } catch (e) {
      logger.error({ evt: "MAIL_SYNC_TICK_ERR" }, e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  };

  logger.info(
    { evt: "MAIL_SYNC_WORKER_STARTED", intervalMs: INTERVAL_MS, limit: LIMIT },
    "Worker synchro IMAP demarre"
  );

  void tick();
  setInterval(tick, INTERVAL_MS);
}
