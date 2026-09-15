/**
 * Contrat métier — perte d'ombrage globale (produit, étude, devis, PDF, calcul).
 * Glossaire complet et snapshot vs live : docs/shading-kpi-contract.md
 * Gouvernance pipelines / autorité : voir `shadingGovernance.js`.
 *
 * VÉRITÉ OFFICIELLE UNIQUE : `shading.combined.totalLossPct`
 * - Agrège near + far selon le moteur raycast / équivalent backend.
 * - En multi-pan, le payload d’étude aligne ce champ sur la moyenne pondérée modules
 *   (voir solarnextPayloadBuilder) ; c’est la même valeur que `installation.shading_loss_pct`.
 *
 * COMPOSANTES TECHNIQUES (ne pas exposer comme « perte globale » sans contexte) :
 * - `shading.near.totalLossPct`, `shading.far.totalLossPct`
 *
 * ALIAS LEGACY (miroir uniquement, jamais prioritaire sur combined si les deux divergent) :
 * - `shading.totalLossPct`, `shading.total_loss_pct` — doivent refléter combined ; sinon warning dev.
 */

import { getShadingComponentLossPct } from "../../../shared/shading/shadingAssessment.js";
const TOL = 0.02;

/**
 * @param {unknown} shading
 * @returns {number|null} Pourcentage [0,100], ou null si inconnu / non applicable.
 */
export function getOfficialGlobalShadingLossPct(shading) {
  return getShadingComponentLossPct(shading, "combined");

}

/**
 * Avertit si la racine et combined divergent (régression / JSON corrompu).
 * @param {object} shading
 */
export function warnIfOfficialShadingRootMismatch(shading) {
  if (process.env.NODE_ENV === "production") return;
  if (!shading || typeof shading !== "object") return;
  const c = shading.combined;
  if (!c || typeof c !== "object" || !Object.prototype.hasOwnProperty.call(c, "totalLossPct")) return;
  const combinedVal = c.totalLossPct;
  if (combinedVal == null || combinedVal === "" || !Number.isFinite(Number(combinedVal))) return;
  const rootVal = shading.totalLossPct ?? shading.total_loss_pct;
  if (rootVal == null || rootVal === "" || !Number.isFinite(Number(rootVal))) return;
  const a = Number(combinedVal);
  const b = Number(rootVal);
  if (Math.abs(a - b) > TOL) {
    console.warn(
      "[SHADING_OFFICIAL] Incohérence : combined.totalLossPct !== totalLossPct racine — la vérité produit est combined.totalLossPct",
      { combined: a, root: b }
    );
  }
}
