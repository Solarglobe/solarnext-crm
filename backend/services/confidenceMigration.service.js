/**
 * Auto-migration au demarrage : correction calculation_confidence.blocking_warnings en DB.
 *
 * Contexte : les codes suivants ont ete reclasses "non-bloquants" pour la generation PDF.
 * Les etudes calculees AVANT ce changement ont ces codes dans blocking_warnings avec level="BLOCKED".
 * L'ancien code Railway verifait `level === "BLOCKED"` -> bloquait toutes ces etudes.
 * Cette migration corrige la donnee en DB une fois pour toutes.
 *
 * Codes deplacees de blocking_warnings -> non_blocking_warnings :
 *   PVGIS_FALLBACK_USED, VB_COST_UNCONFIGURED_BLOCK_PDF, FAR_SHADING_UNAVAILABLE_BLOCK_PDF,
 *   SHADING_PAN_MISMATCH_BLOCK_PDF, SHADING_GEOMETRY_BLOCK_PDF
 *
 * Codes qui restent VRAIMENT bloquants (inchanges) :
 *   CALC_INVALID_8760_PROFILE, VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE
 */

import { pool } from "../config/db.js";
import logger from "../app/core/logger.js";

const TRULY_BLOCKING = new Set([
  "CALC_INVALID_8760_PROFILE",
]);

const NOW_NON_BLOCKING = new Set([
  "PVGIS_FALLBACK_USED",
  "VB_COST_UNCONFIGURED_BLOCK_PDF",
  "FAR_SHADING_UNAVAILABLE_BLOCK_PDF",
  "SHADING_PAN_MISMATCH_BLOCK_PDF",
  "SHADING_GEOMETRY_BLOCK_PDF",
  "VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE",
]);

function recomputeLevel(blockingWarnings, assumptions) {
  if (blockingWarnings.length > 0) return "BLOCKED";
  if (!assumptions || typeof assumptions !== "object") return "HIGH";
  const a = assumptions;
  const lowSignals = [
    a.pvgis_fallback_used === true,
    a.enedis_profile_used === false,
    Number(a.maintenance_pct) === 0,
    a.elec_growth_missing === true,
    Number(a.elec_growth_pct) > 3,
    Number(a.oversell_risk_score) >= 70,
    a.far_shading_unavailable === true,
    (a.shading_geometry_strict_warnings || []).length > 0,
    a.shading_pan_mismatch === true,
  ].filter(Boolean).length;
  if (
    Number(a.oversell_risk_score) >= 70 ||
    lowSignals >= 2 ||
    (a.pvgis_fallback_used && a.enedis_profile_used === false)
  ) return "LOW";
  if (
    a.enedis_profile_used === false ||
    a.pvgis_fallback_used === true ||
    Number(a.maintenance_pct) === 0 ||
    a.elec_growth_missing === true ||
    Number(a.elec_growth_pct) > 3 ||
    Number(a.oversell_risk_score) >= 40 ||
    a.far_shading_unavailable === true ||
    (a.shading_geometry_strict_warnings || []).length > 0 ||
    a.shading_pan_mismatch === true
  ) return "MEDIUM";
  return "HIGH";
}

export async function runConfidenceMigration() {
  // Trouver les study_versions avec level="BLOCKED" dans calculation_confidence
  let rows;
  try {
    const res = await pool.query(`
      SELECT id,
             data_json->'calculation_confidence' AS cc
      FROM study_versions
      WHERE data_json->'calculation_confidence'->>'level' = 'BLOCKED'
        AND (deleted_at IS NULL OR deleted_at > NOW())
    `);
    rows = res.rows;
  } catch (err) {
    // Table absente (env de test sans DB), ne pas crasher
    logger.warn("[confidenceMigration] query failed (non-fatal)", { message: err?.message });
    return;
  }

  if (rows.length === 0) {
    logger.info("[confidenceMigration] aucune etude a corriger");
    return;
  }

  logger.info(`[confidenceMigration] ${rows.length} etude(s) avec level=BLOCKED detectees`);

  let fixed = 0;
  let skipped = 0;

  for (const row of rows) {
    const cc = row.cc;
    if (!cc || typeof cc !== "object") { skipped++; continue; }

    const origBlocking = Array.isArray(cc.blocking_warnings) ? cc.blocking_warnings : [];
    const origNonBlocking = Array.isArray(cc.non_blocking_warnings) ? cc.non_blocking_warnings : [];

    const stillBlocking = origBlocking.filter(w => TRULY_BLOCKING.has(String(w)));
    const toMove = origBlocking.filter(w => NOW_NON_BLOCKING.has(String(w)));
    // Codes inconnus : gardes dans blocking par securite
    const unknown = origBlocking.filter(w => !TRULY_BLOCKING.has(String(w)) && !NOW_NON_BLOCKING.has(String(w)));

    const newBlocking = [...stillBlocking, ...unknown];

    // Si rien ne change (toutes les codes sont vraiment bloquants), ignorer
    if (newBlocking.length === origBlocking.length) { skipped++; continue; }

    const newNonBlocking = Array.from(new Set([...origNonBlocking, ...toMove]));
    const newLevel = recomputeLevel(newBlocking, cc.assumptions);

    try {
      await pool.query(
        `UPDATE study_versions
         SET data_json = jsonb_set(data_json, '{calculation_confidence}', $1::jsonb)
         WHERE id = $2`,
        [
          JSON.stringify({
            ...cc,
            level: newLevel,
            blocking_warnings: newBlocking,
            non_blocking_warnings: newNonBlocking,
          }),
          row.id,
        ]
      );
      fixed++;
    } catch (updateErr) {
      logger.warn(`[confidenceMigration] UPDATE failed for version ${row.id}`, { message: updateErr?.message });
    }
  }

  logger.info(`[confidenceMigration] termine : ${fixed} corriges, ${skipped} ignores`);
  console.log(`[confidenceMigration] termine : ${fixed} etudes corrigees, ${skipped} ignorees`);
}
