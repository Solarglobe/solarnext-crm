/**
 * dcAcRatio.js — Calcul et validation du ratio DC/AC (surdimensionnement onduleur).
 *
 * Module PUR : aucune dépendance DB, aucun import HTTP.
 *
 * Référence : guide SMA "Oversizing PV Array" + UTE C 15-712-1 §5.4.
 * Plage optimale : 1.10 – 1.30 (résidentiel France).
 */

// ─── Limites ───────────────────────────────────────────────────────────────────

const RATIO_MIN_WARNING = 1.05;  // En dessous : onduleur sous-utilisé
const RATIO_OPTIMAL_MIN = 1.10;  // Début zone optimale
const RATIO_OPTIMAL_MAX = 1.30;  // Fin zone optimale
const RATIO_MAX_ERROR    = 1.40; // Au-delà : clipping excessif (> 8 % pertes)

/**
 * Calcule le ratio DC/AC et estime le clipping.
 *
 * Formule clipping (approximation linéaire) :
 *   clipping_pct ≈ max(0, (ratio − 1.25) × 8)
 * Source : étude DNI SMA — clipping commence significativement au-dessus de 1.25.
 *
 * @param {object} params
 * @param {number} params.panelWp      — Puissance crête d'un panneau (Wc)
 * @param {number} params.panelCount   — Nombre total de panneaux
 * @param {number} params.inverterKw   — Puissance nominale AC onduleur (kW)
 *
 * @returns {{
 *   ratioDcAc: number,
 *   peakDcKw: number,
 *   acNominalKw: number,
 *   clippingEstimatePct: number,
 *   status: 'ok'|'warning'|'error',
 *   message: string
 * }}
 */
export function computeDcAcRatio({ panelWp, panelCount, inverterKw }) {
  const peakDcKw = (panelWp * panelCount) / 1000;
  const ratio    = inverterKw > 0 ? peakDcKw / inverterKw : 0;
  const clippingEstimatePct = Math.max(0, (ratio - RATIO_OPTIMAL_MAX) * 8);

  let status;
  let message;

  if (ratio < RATIO_MIN_WARNING) {
    status  = "warning";
    message = `Ratio DC/AC = ${ratio.toFixed(2)} — onduleur surdimensionné (sous-utilisation). Optimal : ${RATIO_OPTIMAL_MIN}–${RATIO_OPTIMAL_MAX}`;
  } else if (ratio > RATIO_MAX_ERROR) {
    status  = "error";
    message = `Ratio DC/AC = ${ratio.toFixed(2)} — clipping estimé ${clippingEstimatePct.toFixed(1)} % (> ${RATIO_MAX_ERROR} déconseillé). Réduire le champ PV ou augmenter la puissance AC.`;
  } else if (ratio > RATIO_OPTIMAL_MAX) {
    status  = "warning";
    message = `Ratio DC/AC = ${ratio.toFixed(2)} — clipping estimé ${clippingEstimatePct.toFixed(1)} % (zone à surveiller : ${RATIO_OPTIMAL_MAX}–${RATIO_MAX_ERROR})`;
  } else if (ratio < RATIO_OPTIMAL_MIN) {
    status  = "warning";
    message = `Ratio DC/AC = ${ratio.toFixed(2)} — en dessous de l'optimum ${RATIO_OPTIMAL_MIN}–${RATIO_OPTIMAL_MAX}, rendement annuel légèrement réduit`;
  } else {
    status  = "ok";
    message = `Ratio DC/AC = ${ratio.toFixed(2)} — dans la plage optimale ${RATIO_OPTIMAL_MIN}–${RATIO_OPTIMAL_MAX} ✓`;
  }

  return {
    ratioDcAc:            Math.round(ratio * 1000) / 1000,
    peakDcKw:             Math.round(peakDcKw * 100) / 100,
    acNominalKw:          inverterKw,
    clippingEstimatePct:  Math.round(clippingEstimatePct * 10) / 10,
    status,
    message,
  };
}
