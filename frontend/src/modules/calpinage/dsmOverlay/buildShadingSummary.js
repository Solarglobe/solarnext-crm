import { getOfficialGlobalShadingLossPct } from "../shading/officialGlobalShadingLoss.js";

/**
 * CP-FAR-C-09 — Perte d’ombrage globale produit (voir officialGlobalShadingLoss : combined.totalLossPct).
 * Unité: % 0–100. Pas d'arrondi (comparaison test sur float).
 * Objet absent → 0 (pas d’étude chargée). Objet présent mais inconnu / GPS → null.
 */
export function getTotalLossPctFromShading(shading) {
  if (shading == null || typeof shading !== "object") return 0;
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
  annualProductionKwh,
  pricePerKwh,
  qualityScore,
  source,
}) {
  const pct =
    totalLossPct === null
      ? null
      : typeof totalLossPct === "number" && !isNaN(totalLossPct)
        ? Math.max(0, Math.min(100, totalLossPct))
        : 0;
  const prodKwh = typeof annualProductionKwh === "number" && annualProductionKwh > 0 ? annualProductionKwh : 0;
  const price = typeof pricePerKwh === "number" && pricePerKwh >= 0 ? pricePerKwh : 0.2;

  const annualLossKwh = prodKwh > 0 && pct != null ? (prodKwh * pct) / 100 : 0;
  const annualLossEuro = annualLossKwh * price;

  const confidence = typeof qualityScore === "number" && !isNaN(qualityScore) ? Math.max(0, Math.min(1, qualityScore)) : null;
  const confidenceSource = typeof source === "string" ? source : null;

  return {
    totalLossPct: pct === null ? null : Math.round(pct * 10) / 10,
    annualLossKwh: Math.round(annualLossKwh),
    annualLossEuro: Math.round(annualLossEuro),
    confidence,
    confidenceSource,
  };
}
