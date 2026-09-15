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
 * Les faits critiques d'ombrage sont réévalués avant tout déclassement : une
 * hauteur/échelle absente ou un écart au seuil de blocage ne devient pas une réserve.
 */

import { pool } from "../config/db.js";
import logger from "../app/core/logger.js";
import { shadingExportBlockers } from './shading/shadingExportGuard.service.js';

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

export function migrateCalculationConfidence(cc) {
  if(!cc||typeof cc!=='object')return cc;
  const isShading = code => String(code).startsWith('SHADING_') || String(code).startsWith('FAR_SHADING_');
  const original = cc.blocking_warnings ?? [];
  const blocking = original.filter(code => !NOW_NON_BLOCKING.has(code) && !isShading(code));
  const notices = [...(cc.non_blocking_warnings ?? []), ...original.filter(code => !blocking.includes(code)), ...shadingExportBlockers({assumptions:cc.assumptions}).map(x=>x.code)];
  return {...cc, level:recomputeLevel(blocking,cc.assumptions), blocking_warnings:blocking, non_blocking_warnings:[...new Set(notices)]};
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

    const next=migrateCalculationConfidence(cc);
    if(JSON.stringify(next)===JSON.stringify(cc)){skipped++;continue;}

    try {
      await pool.query(
        `UPDATE study_versions
         SET data_json = jsonb_set(data_json, '{calculation_confidence}', $1::jsonb)
         WHERE id = $2`,
        [
          JSON.stringify(next),
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
