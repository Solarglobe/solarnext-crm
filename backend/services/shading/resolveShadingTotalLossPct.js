/**
 * Résout le pourcentage de perte d'ombrage globale pour snapshot / PDF / scénarios.
 * Aucun recalcul physique — même règle que `getOfficialGlobalShadingLossPct` sur `shading`,
 * puis repli contrôlé sur champs formulaire / installation.
 *
 * @see ./officialShadingTruth.js — docs/shading-kpi-contract.md
 */

import {
  getOfficialGlobalShadingLossPct,
  warnIfOfficialShadingRootMismatch,
} from "./officialShadingTruth.js";

/**
 * Priorité :
 * 1. GPS bloqué → null (pas de repli formulaire — aligné comportement historique)
 * 2. `getOfficialGlobalShadingLossPct(shading)` (combined → legacy racine)
 * 3. `combined.totalLossPct` explicitement absent / null → null (pas de repli formulaire)
 * 4. form.installation.shading_loss_pct / form.shadingLossPct
 * 5. null
 *
 * @param {object|null|undefined} shading - ex. installation.shading (V2) ou snapshot.shading partiel
 * @param {object|null|undefined} form - ex. ctx.form ou snapshot.form
 * @returns {number|null}
 */
export function resolveShadingTotalLossPct(shading, form) {
  const s = shading && typeof shading === "object" ? shading : {};
  warnIfOfficialShadingRootMismatch(s);

  if (
    s.shadingQuality?.blockingReason === "missing_gps" ||
    s.far?.source === "UNAVAILABLE_NO_GPS" ||
    s.far?.source === "FAR_UNAVAILABLE_ERROR" ||
    s.shadingQuality?.farShadingUnavailable === true
  ) {
    return null;
  }

  const fromShading = getOfficialGlobalShadingLossPct(s);
  if (fromShading != null) return fromShading;

  const c = s.combined;
  if (
    c &&
    typeof c === "object" &&
    Object.prototype.hasOwnProperty.call(c, "totalLossPct") &&
    (c.totalLossPct == null || c.totalLossPct === "")
  ) {
    return null;
  }

  const f = form && typeof form === "object" ? form : {};
  const installation = f.installation && typeof f.installation === "object" ? f.installation : {};

  const fromForm = pickFiniteLossPct(installation.shading_loss_pct) ?? pickFiniteLossPct(f.shadingLossPct);
  return fromForm;
}

function pickFiniteLossPct(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}
