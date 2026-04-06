/**
 * Fiabilité affichée / exportée pour horizon relief synthétique (RELIEF_ONLY, etc.).
 * Ne modifie pas les calculs physiques d'ombrage — uniquement métadonnées de confiance.
 */

/** Score 0–1 plafonné pour toute source non terrain réel (aligné produit). */
export const SYNTHETIC_MAX_CONFIDENCE_01 = 0.3;

/** Équivalent 0–100 pour far.confidenceScore (backend CP-FAR-010). */
export const SYNTHETIC_MAX_CONFIDENCE_100 = 30;

/**
 * @param {string|null|undefined} source - far.source / dataCoverage.provider / meta.source
 * @returns {boolean}
 */
export function isStrictSyntheticReliefSource(source) {
  if (!source || typeof source !== "string") return false;
  return source === "RELIEF_ONLY" || source === "SYNTHETIC_STUB";
}

/**
 * @param {number|null|undefined} confidence01
 * @param {string|null|undefined} source
 * @returns {number|null}
 */
export function capConfidence01ForSource(confidence01, source) {
  if (!isStrictSyntheticReliefSource(source)) return confidence01;
  if (confidence01 == null || Number.isNaN(Number(confidence01))) return SYNTHETIC_MAX_CONFIDENCE_01;
  return Math.min(SYNTHETIC_MAX_CONFIDENCE_01, Math.max(0, Number(confidence01)));
}
