import { getOfficialGlobalShadingLossPct } from "../shading/officialGlobalShadingLoss.js";

/**
 * CP-FAR-C-09 — Perte d’ombrage globale produit (voir officialGlobalShadingLoss : combined.totalLossPct).
 * Unité: % 0–100. Pas d'arrondi (comparaison test sur float).
 * Objet absent → null (pas de calcul). Objet présent mais inconnu / GPS → null.
 */
export function getTotalLossPctFromShading(shading) {
  if (shading == null || typeof shading !== "object") return null;
  return getOfficialGlobalShadingLossPct(shading);
}

/**
 * CP-DSM-017 — Calcul produit centralisé pour Analyse Ombres.
 * Fonction pure : transforme les données shading en résumé décisionnel.
 *
 * @param {Object} params
 * @param {number} params.totalLossPct - Perte totale ombrage (%)
 * @param {number|null} params.annualProductionKwh - Production annuelle brute (kWh)
 * @param {number} [params.pricePerKwh=0.20] - Prix €/kWh (fallback 0.20)
 * @param {number|null} params.qualityScore - Score fiabilité [0-1] ou null (souvent null si horizon synthétique)
 * @param {string|null} params.source - Source technique horizon (export / traçabilité)
 * @returns {{ totalLossPct: number, annualLossKwh: number, annualLossEuro: number, confidence: number|null, confidenceSource: string|null }}
 */
export function buildShadingSummary({
  totalLossPct,
  annualLossKwh: assessedAnnualLossKwh,
  pricePerKwh,
  qualityScore,
  source,
}) {
  const pct = typeof totalLossPct === "number" && Number.isFinite(totalLossPct) && totalLossPct >= 0 && totalLossPct <= 100 ? totalLossPct : null;
  const price = typeof pricePerKwh === "number" && Number.isFinite(pricePerKwh) && pricePerKwh >= 0 ? pricePerKwh : 0.2;
  const annualLossKwh = pct != null && typeof assessedAnnualLossKwh === "number" && Number.isFinite(assessedAnnualLossKwh) && assessedAnnualLossKwh >= 0 ? assessedAnnualLossKwh : null;
  const annualLossEuro = annualLossKwh == null ? null : annualLossKwh * price;

  const confidence = typeof qualityScore === "number" && !isNaN(qualityScore) ? Math.max(0, Math.min(1, qualityScore)) : null;
  const confidenceSource = typeof source === "string" ? source : null;

  return {
    totalLossPct: pct,
    annualLossKwh,
    annualLossEuro,
    confidence,
    confidenceSource,
  };
}
