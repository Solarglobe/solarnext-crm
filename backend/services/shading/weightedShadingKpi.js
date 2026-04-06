/**
 * KPI ombrage « combiné » aligné sur la production multi-pan.
 * Moyenne pondérée des shadingCombinedPct par pan, poids = nombre de modules (panelCount).
 * Même pondération que la somme des productions dans computeProductionMultiPan
 * (chaque pan : prod ∝ panelCount × (1 - shadingCombinedPct/100)).
 *
 * Sémantique vs moteur raycast unique : docs/shading-kpi-contract.md §2.4
 * (valeur injectée dans `shading.combined.totalLossPct` côté payload étude, pas un second champ JSON.)
 */

/**
 * @param {Array<{ panelCount?: number, panel_count?: number, shadingCombinedPct?: number, shading_combined_pct?: number }>} roofPans
 * @returns {number|null} Valeur arrondie 3 décimales, ou null si aucun pan / aucun module.
 */
export function computeWeightedShadingCombinedPct(roofPans) {
  if (!Array.isArray(roofPans) || roofPans.length === 0) return null;
  let sumW = 0;
  let sumPct = 0;
  for (const p of roofPans) {
    const cnt = Math.max(0, Math.floor(Number(p.panelCount ?? p.panel_count) || 0));
    const sh = Math.max(0, Math.min(100, Number(p.shadingCombinedPct ?? p.shading_combined_pct) || 0));
    sumW += cnt;
    sumPct += sh * cnt;
  }
  if (sumW <= 0) return null;
  return Math.round((sumPct / sumW) * 1000) / 1000;
}
