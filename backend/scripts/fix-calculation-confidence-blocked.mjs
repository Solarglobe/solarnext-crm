/**
 * Migration : correction calculation_confidence.blocking_warnings en DB.
 *
 * Contexte :
 *   Les codes suivants ont ete reclasses "non-bloquants" pour la generation PDF :
 *     - PVGIS_FALLBACK_USED
 *     - VB_COST_UNCONFIGURED_BLOCK_PDF
 *     - FAR_SHADING_UNAVAILABLE_BLOCK_PDF
 *     - SHADING_PAN_MISMATCH_BLOCK_PDF
 *     - SHADING_GEOMETRY_BLOCK_PDF
 *
 *   Mais les etudes calculees avant ce changement ont ces codes dans blocking_warnings
 *   avec level="BLOCKED" persiste en DB.
 *
 *   L'ancien code Railway verifait `level === "BLOCKED"` -> bloquait TOUTES ces etudes.
 *   Ce script corrige la donnee en DB : deplace ces codes vers non_blocking_warnings
 *   et recalcule le level.
 *
 * Usage :
 *   node backend/scripts/fix-calculation-confidence-blocked.mjs           # dry-run
 *   node backend/scripts/fix-calculation-confidence-blocked.mjs --apply   # applique
 */

import "../config/register-local-env.js";
import { pool } from "../config/db.js";

const APPLY = process.argv.includes("--apply");

// Codes qui bloquent VRAIMENT (doivent rester dans blocking_warnings)
const TRULY_BLOCKING = new Set([
  "CALC_INVALID_8760_PROFILE",
]);

// Codes reclasses non-bloquants (a deplacer vers non_blocking_warnings)
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

  const lowSignals = [
    assumptions.pvgis_fallback_used === true,
    assumptions.enedis_profile_used === false,
    Number(assumptions.maintenance_pct) === 0,
    assumptions.elec_growth_missing === true,
    Number(assumptions.elec_growth_pct) > 3,
    Number(assumptions.oversell_risk_score) >= 70,
    assumptions.far_shading_unavailable === true,
    (assumptions.shading_geometry_strict_warnings || []).length > 0,
    assumptions.shading_pan_mismatch === true,
  ].filter(Boolean).length;

  if (
    Number(assumptions.oversell_risk_score) >= 70 ||
    lowSignals >= 2 ||
    (assumptions.pvgis_fallback_used && assumptions.enedis_profile_used === false)
  ) return "LOW";

  if (
    assumptions.enedis_profile_used === false ||
    assumptions.pvgis_fallback_used === true ||
    Number(assumptions.maintenance_pct) === 0 ||
    assumptions.elec_growth_missing === true ||
    Number(assumptions.elec_growth_pct) > 3 ||
    Number(assumptions.oversell_risk_score) >= 40 ||
    assumptions.far_shading_unavailable === true ||
    (assumptions.shading_geometry_strict_warnings || []).length > 0 ||
    assumptions.shading_pan_mismatch === true
  ) return "MEDIUM";

  return "HIGH";
}

async function run() {
  console.log(`\n=== fix-calculation-confidence-blocked (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  // 1. Trouver toutes les study_versions avec level="BLOCKED" dans calculation_confidence
  const { rows } = await pool.query(`
    SELECT id, study_id, organization_id,
           data_json->'calculation_confidence' AS cc
    FROM study_versions
    WHERE data_json->'calculation_confidence'->>'level' = 'BLOCKED'
      AND deleted_at IS NULL
  `);

  console.log(`Etudes trouvees avec level="BLOCKED" : ${rows.length}`);

  let countFixed = 0;
  let countStillBlocked = 0;
  let countSkipped = 0;

  for (const row of rows) {
    const cc = row.cc;
    if (!cc || typeof cc !== "object") { countSkipped++; continue; }

    const origBlocking = Array.isArray(cc.blocking_warnings) ? cc.blocking_warnings : [];
    const origNonBlocking = Array.isArray(cc.non_blocking_warnings) ? cc.non_blocking_warnings : [];

    // Separer : garder bloquants / deplacer non-bloquants
    const stillBlocking = origBlocking.filter(w => TRULY_BLOCKING.has(String(w)));
    const toMove = origBlocking.filter(w => NOW_NON_BLOCKING.has(String(w)));
    const unknown = origBlocking.filter(w => !TRULY_BLOCKING.has(String(w)) && !NOW_NON_BLOCKING.has(String(w)));

    // Codes inconnus : on les garde dans blocking par securite
    const newBlocking = [...stillBlocking, ...unknown];

    // Non-blocking : merge + dedup
    const newNonBlocking = Array.from(new Set([...origNonBlocking, ...toMove]));

    const newLevel = recomputeLevel(newBlocking, cc.assumptions);

    if (newBlocking.length === origBlocking.length && newLevel === cc.level) {
      // Rien ne change (deja correct ou vraiment bloque)
      if (stillBlocking.length > 0 || unknown.length > 0) {
        console.log(`  [STILL_BLOCKED] version=${row.id} study=${row.study_id} blocking=${JSON.stringify(newBlocking)}`);
        countStillBlocked++;
      } else {
        countSkipped++;
      }
      continue;
    }

    console.log(`  [FIX] version=${row.id} study=${row.study_id}`);
    console.log(`    blocking: ${JSON.stringify(origBlocking)} -> ${JSON.stringify(newBlocking)}`);
    console.log(`    moved to non_blocking: ${JSON.stringify(toMove)}`);
    console.log(`    level: ${cc.level} -> ${newLevel}`);
    if (unknown.length > 0) console.log(`    unknown codes (kept blocking): ${JSON.stringify(unknown)}`);

    if (APPLY) {
      const newCc = {
        ...cc,
        level: newLevel,
        blocking_warnings: newBlocking,
        non_blocking_warnings: newNonBlocking,
      };
      await pool.query(
        `UPDATE study_versions
         SET data_json = jsonb_set(data_json, '{calculation_confidence}', $1::jsonb)
         WHERE id = $2`,
        [JSON.stringify(newCc), row.id]
      );
    }

    countFixed++;
  }

  console.log(`\n=== Resultats ===`);
  console.log(`  A corriger / corriges : ${countFixed}`);
  console.log(`  Vraiment bloques (laisses tels quels) : ${countStillBlocked}`);
  console.log(`  Ignores (pas de changement) : ${countSkipped}`);

  if (!APPLY && countFixed > 0) {
    console.log(`\nRelancez avec --apply pour appliquer les corrections.`);
  } else if (APPLY && countFixed > 0) {
    console.log(`\nCorrections appliquees en DB. Les PDFs devraient maintenant se generer.`);
  } else if (countFixed === 0) {
    console.log(`\nAucune correction necessaire.`);
  }

  await pool.end();
}

run().catch(err => {
  console.error("ERREUR MIGRATION:", err);
  process.exit(1);
});
