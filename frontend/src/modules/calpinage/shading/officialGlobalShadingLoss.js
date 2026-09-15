import { getShadingComponentLossPct } from "../../../../../shared/shading/shadingAssessment.js";

/**
 * Contrat métier — aligné avec `backend/services/shading/officialShadingTruth.js`.
 * Glossaire KPI + snapshot vs live : docs/shading-kpi-contract.md
 *
 * VÉRITÉ OFFICIELLE : `shading.combined.totalLossPct` = perte d’ombrage globale (near+far / KPI production).
 * `near` / `far` = diagnostics. `totalLossPct` racine = alias miroir de combined lorsque présent.
 */

/**
 * @param {unknown} shading - state.shading.normalized ou équivalent export / API
 * @returns {number|null} [0,100] ou null (GPS manquant, far indisponible, ou total inconnu).
 */
export function getOfficialGlobalShadingLossPct(shading) {
  return getShadingComponentLossPct(shading, "combined");
}

/**
 * Pour affichage / multiplicateur énergie : null → défaut métier (souvent 0 = pas de perte déclarée).
 * @param {unknown} shading
 * @param {number} [whenNull=0]
 * @returns {number}
 */
export function getOfficialGlobalShadingLossPctOr(shading, whenNull = 0) {
  const v = getOfficialGlobalShadingLossPct(shading);
  return v == null ? whenNull : v;
}

/**
 * Perte globale **affichage produit** depuis le sous-état calpinage `state.shading`.
 * 1) `normalized` → `getOfficialGlobalShadingLossPct` (vérité V2 / contrat KPI).
 * 2) Sinon `lastResult.annualLossPercent` → même helper sur une forme minimale `{ combined }`
 *    (live avant sync normalizer ; même agrégat global que le futur `combined`).
 *
 * @param {{ normalized?: object|null, lastResult?: { annualLossPercent?: number }|null }|null|undefined} stateSlice
 * @returns {number|null}
 */
export function getGlobalShadingLossPctForCalpinageShadingState(stateSlice) {
  if (stateSlice == null || typeof stateSlice !== "object") return null;
  if (stateSlice.lastAbortReason || stateSlice.lastError) return null;
  const norm = stateSlice.normalized;
  if (norm != null && typeof norm === "object") return getOfficialGlobalShadingLossPct(norm);
  // A live result without the assessment contract cannot validate coverage.
  if (stateSlice.lastResult?.assessment) return getOfficialGlobalShadingLossPct(stateSlice.lastResult);
  return null;
}

/**
 * @param {unknown} shading
 */
export function warnIfOfficialShadingRootMismatch(shading) {
  if (typeof import.meta !== "undefined" && import.meta.env?.PROD) return;
  if (shading == null || typeof shading !== "object") return;
  const c = shading.combined;
  if (!c || typeof c !== "object" || !Object.prototype.hasOwnProperty.call(c, "totalLossPct")) return;
  const combinedVal = c.totalLossPct;
  if (combinedVal == null || combinedVal === "" || !Number.isFinite(Number(combinedVal))) return;
  const rootVal = shading.totalLossPct ?? shading.total_loss_pct;
  if (rootVal == null || rootVal === "" || !Number.isFinite(Number(rootVal))) return;
  const a = Number(combinedVal);
  const b = Number(rootVal);
  if (Math.abs(a - b) > 0.02 && typeof console !== "undefined" && console.warn) {
    console.warn(
      "[SHADING_OFFICIAL] combined.totalLossPct !== totalLossPct racine — référence produit : combined",
      { combined: a, root: b }
    );
  }
}
