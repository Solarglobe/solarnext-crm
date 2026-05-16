/**
 * financialScenarios.service.js
 *
 * Service d'écriture dans la table canonical `financial_scenarios`.
 *
 * Architecture dual-write :
 *  - study_versions.data_json.scenarios_v2 = SOURCE DE LECTURE (inchangée)
 *  - financial_scenarios                   = SOURCE D'AUDIT / ANALYTICS (additive)
 *
 * Deux fonctions publiques :
 *  - upsertFinancialScenariosForVersion : appelée après chaque calcul réussi
 *  - lockFinancialScenario              : appelée après sélection + gel du scénario
 *
 * Toutes les écritures sont non-bloquantes pour le flux métier principal
 * (le caller doit faire `void upsertFinancialScenariosForVersion(...).catch(...)`).
 */

import { createHash } from "crypto";
import { pool } from "../config/db.js";
import { ENGINE_VERSION } from "../constants/engineVersion.js";

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** SHA-256 d'un objet JS (sérialisé JSON avec clés triées pour déterminisme). */
function hashObject(obj) {
  if (obj == null) return null;
  try {
    const json = JSON.stringify(obj, Object.keys(obj).sort());
    return createHash("sha256").update(json).digest("hex");
  } catch {
    return null;
  }
}

/** Label humain par défaut en fonction de scenario_id. */
function defaultLabel(scenarioId) {
  switch (scenarioId) {
    case "BASE":             return "Scénario sans batterie";
    case "BATTERY_PHYSICAL": return "Scénario batterie physique";
    case "BATTERY_VIRTUAL":  return "Scénario batterie virtuelle";
    case "BATTERY_HYBRID":   return "Scénario batterie hybride";
    default:                 return scenarioId;
  }
}

/**
 * Extrait les colonnes dénormalisées d'un objet scenario_v2.
 * Supporte les aliases irr_pct / tri_pct.
 */
function extractFinancialFields(scenario) {
  const fin = scenario?.finance ?? {};
  return {
    capex_ttc: fin.capex_ttc   ?? null,
    roi_years: fin.roi_years   ?? null,
    irr_pct:   fin.irr_pct     ?? fin.tri_pct ?? null,
  };
}

/* ── upsertFinancialScenariosForVersion ───────────────────────────────────── */

/**
 * Upserte un enregistrement `financial_scenarios` pour chaque scénario présent
 * dans `scenariosV2`.
 *
 * @param {Object} params
 * @param {string}   params.organizationId
 * @param {string}   params.studyId
 * @param {string}   params.studyVersionId   UUID de study_versions
 * @param {Object}   params.solarnextPayload  Snapshot figé des entrées moteur
 * @param {Array}    params.scenariosV2       ctxFinal.scenarios_v2
 * @param {string|null} params.userId         Auteur du calcul (peut être null)
 * @returns {Promise<void>}
 */
export async function upsertFinancialScenariosForVersion({
  organizationId,
  studyId,
  studyVersionId,
  solarnextPayload,
  scenariosV2,
  userId = null,
}) {
  if (!Array.isArray(scenariosV2) || scenariosV2.length === 0) return;

  const inputHash = hashObject(solarnextPayload);

  for (const scenario of scenariosV2) {
    const scenarioId = scenario?.id ?? scenario?.name;
    if (!scenarioId) continue;

    const { capex_ttc, roi_years, irr_pct } = extractFinancialFields(scenario);
    const resultHash = hashObject(scenario);
    const label = scenario?.label ?? defaultLabel(scenarioId);

    try {
      await pool.query(
        `INSERT INTO financial_scenarios (
           organization_id, study_id, study_version_id, scenario_id,
           label,
           input_params, results,
           input_hash, result_hash,
           engine_version,
           capex_ttc, roi_years, irr_pct,
           status,
           created_by, updated_at
         ) VALUES (
           $1, $2, $3, $4,
           $5,
           $6::jsonb, $7::jsonb,
           $8, $9,
           $10,
           $11, $12, $13,
           'DRAFT',
           $14, NOW()
         )
         ON CONFLICT (study_version_id, scenario_id) DO UPDATE SET
           label          = EXCLUDED.label,
           input_params   = EXCLUDED.input_params,
           results        = EXCLUDED.results,
           input_hash     = EXCLUDED.input_hash,
           result_hash    = EXCLUDED.result_hash,
           engine_version = EXCLUDED.engine_version,
           capex_ttc      = EXCLUDED.capex_ttc,
           roi_years      = EXCLUDED.roi_years,
           irr_pct        = EXCLUDED.irr_pct,
           status         = CASE
             WHEN financial_scenarios.status = 'LOCKED' THEN 'DRAFT'
             ELSE financial_scenarios.status
           END,
           locked_at      = CASE
             WHEN financial_scenarios.status = 'LOCKED' THEN NULL
             ELSE financial_scenarios.locked_at
           END,
           updated_at     = NOW()`,
        [
          organizationId, studyId, studyVersionId, scenarioId,  // $1-$4
          label,                                                  // $5
          JSON.stringify(solarnextPayload ?? {}),                 // $6
          JSON.stringify(scenario),                               // $7
          inputHash, resultHash,                                  // $8-$9
          ENGINE_VERSION,                                         // $10
          capex_ttc, roi_years, irr_pct,                         // $11-$13
          userId,                                                 // $14
        ]
      );
    } catch (err) {
      // Log non-bloquant : ne jamais interrompre le flux métier
      console.error("[financialScenarios] upsert failed for scenarioId =", scenarioId, err?.message);
    }
  }
}

/* ── lockFinancialScenario ────────────────────────────────────────────────── */

/**
 * Verrouille le scénario sélectionné (status → LOCKED, locked_at → NOW()).
 * Les autres scénarios de la même version passent à ARCHIVED.
 *
 * @param {string} studyVersionId   UUID de study_versions
 * @param {string} scenarioId       Ex. "BASE"
 * @returns {Promise<void>}
 */
export async function lockFinancialScenario(studyVersionId, scenarioId) {
  if (!studyVersionId || !scenarioId) return;

  try {
    // Lock le scénario sélectionné
    await pool.query(
      `UPDATE financial_scenarios
         SET status = 'LOCKED', locked_at = NOW(), updated_at = NOW()
       WHERE study_version_id = $1 AND scenario_id = $2
         AND status != 'LOCKED'`,
      [studyVersionId, scenarioId]
    );

    // Archive les scénarios non sélectionnés de la même version
    await pool.query(
      `UPDATE financial_scenarios
         SET status = 'ARCHIVED', updated_at = NOW()
       WHERE study_version_id = $1 AND scenario_id != $2
         AND status = 'DRAFT'`,
      [studyVersionId, scenarioId]
    );
  } catch (err) {
    console.error("[financialScenarios] lockFinancialScenario failed:", err?.message);
  }
}
