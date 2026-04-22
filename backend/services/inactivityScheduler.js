/**
 * Scheduler de recalcul quotidien de l'inactivité des leads.
 * Lance le recalcul chaque jour à 2h du matin (heure serveur).
 * Utilise setTimeout natif — aucune dépendance externe.
 */

import { pool } from "../config/db.js";
import { recalculateLeadScore } from "./leadScoring.service.js";
import logger from "../app/core/logger.js";

const JOB_HOUR = 2; // 2h du matin

/**
 * Calcule le nombre de millisecondes jusqu'au prochain JOB_HOUR:00:00.
 */
function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(JOB_HOUR, 0, 0, 0);
  if (next <= now) {
    // Déjà passé aujourd'hui → demain
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Recalcule score + inactivité pour tous les leads non archivés.
 * Traitement par lots de 100 pour ne pas saturer la DB.
 */
async function runDailyInactivityRecalculation() {
  const startedAt = Date.now();
  logger.info("INACTIVITY_JOB_START", { scheduledAt: new Date().toISOString() });

  let processed = 0;
  let errors = 0;
  const BATCH = 100;
  let offset = 0;

  try {
    while (true) {
      const { rows } = await pool.query(
        `SELECT id, organization_id FROM leads
         WHERE archived_at IS NULL AND status != 'ARCHIVED'
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [BATCH, offset]
      );

      if (rows.length === 0) break;

      for (const row of rows) {
        try {
          await recalculateLeadScore(row.id, row.organization_id);
          processed++;
        } catch {
          errors++;
        }
      }

      offset += BATCH;

      // Petite pause entre les lots pour ne pas bloquer le pool
      if (rows.length === BATCH) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch (err) {
    logger.error("INACTIVITY_JOB_ERROR", { error: err?.message });
  }

  const durationMs = Date.now() - startedAt;
  logger.info("INACTIVITY_JOB_DONE", { processed, errors, durationMs });
}

/**
 * Lance la boucle de planification.
 * À appeler une seule fois au démarrage du serveur.
 */
export function startInactivityScheduler() {
  function scheduleNext() {
    const delay = msUntilNextRun();
    const nextRun = new Date(Date.now() + delay);
    logger.info("INACTIVITY_JOB_SCHEDULED", {
      nextRun: nextRun.toISOString(),
      inMs: delay,
    });

    setTimeout(async () => {
      await runDailyInactivityRecalculation();
      scheduleNext(); // Re-planifie le lendemain
    }, delay);
  }

  scheduleNext();
}
