/**
 * Métadonnées de confiance — relief synthétique (RELIEF_ONLY / stub).
 * Aucun impact sur les pertes physiques ; cohérence UI / export / JSON.
 */

export const SYNTHETIC_MAX_CONFIDENCE_01 = 0.3;

const SYNTHETIC_SOURCES = new Set(["RELIEF_ONLY", "SYNTHETIC_STUB"]);

/**
 * @param {string|null|undefined} farSource - far.source / meta.source
 * @param {string|null|undefined} [modelType] - shadingQuality.modelType
 * @returns {boolean}
 */
export function isSyntheticReliefConfidenceContext(farSource, modelType) {
  if (modelType === "SYNTHETIC") return true;
  if (!farSource || typeof farSource !== "string") return false;
  return SYNTHETIC_SOURCES.has(farSource);
}

/**
 * @param {number|null|undefined} score01
 * @returns {number}
 */
export function capSyntheticConfidenceScore01(score01) {
  if (score01 == null || Number.isNaN(Number(score01))) return SYNTHETIC_MAX_CONFIDENCE_01;
  return Math.min(SYNTHETIC_MAX_CONFIDENCE_01, Math.max(0, Number(score01)));
}

/**
 * @param {{ score?: number }} sq
 * @returns {number}
 */
function normalizeShadingQualityScoreTo01(sq) {
  if (!sq || typeof sq.score !== "number" || Number.isNaN(sq.score)) return SYNTHETIC_MAX_CONFIDENCE_01;
  if (sq.score <= 1) return capSyntheticConfidenceScore01(sq.score);
  return capSyntheticConfidenceScore01(sq.score / 100);
}

/**
 * Export premium : plafonne champs trompeurs pour sources synthétiques strictes.
 * @param {object} out - sortie buildPremiumShadingExport (avant return)
 * @returns {object}
 */
export function applySyntheticReliefToPremiumExport(out) {
  if (!out || typeof out !== "object") return out;
  const src = out.far?.source ?? out.source;
  const sqIn = out.shadingQuality && typeof out.shadingQuality === "object" ? out.shadingQuality : {};
  const modelType = sqIn.modelType;
  if (!isSyntheticReliefConfidenceContext(src, modelType)) return out;

  const score01 = normalizeShadingQualityScoreTo01(sqIn);
  const shadingQuality = {
    ...sqIn,
    confidence: "LOW",
    confidenceScore: capSyntheticConfidenceScore01(
      typeof sqIn.confidenceScore === "number" ? sqIn.confidenceScore : score01
    ),
    score: score01,
    note: sqIn.note === "synthetic_relief" ? sqIn.note : "synthetic_relief",
    provider: sqIn.provider ?? src,
    farHorizonKind:
      sqIn.farHorizonKind === "REAL_TERRAIN" ? "SYNTHETIC" : (sqIn.farHorizonKind ?? "SYNTHETIC"),
  };

  return {
    ...out,
    confidence: "LOW",
    shadingQuality,
  };
}
