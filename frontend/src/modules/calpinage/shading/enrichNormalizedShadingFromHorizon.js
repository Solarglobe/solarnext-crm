/**
 * Après fetch /api/horizon-mask + computeCalpinageShading, enrichit shading.normalized
 * avec la même traçabilité que buildStructuredShading côté backend (far.source, shadingQuality, etc.).
 * Sans ce lien, buildPremiumShadingExport et les KPI « terrain réel » restent sur des défauts trompeurs.
 */

/** @type {ReadonlySet<string>} */
const REAL_TERRAIN_PROVIDERS = new Set(["IGN_RGE_ALTI", "HTTP_GEOTIFF", "DSM_REAL"]);

/**
 * @param {string|null|undefined} provider
 * @returns {"REAL_TERRAIN"|"SYNTHETIC"|"UNAVAILABLE"}
 */
export function farHorizonKindFromProvider(provider) {
  if (provider === "UNAVAILABLE_NO_GPS") return "UNAVAILABLE";
  return typeof provider === "string" && REAL_TERRAIN_PROVIDERS.has(provider) ? "REAL_TERRAIN" : "SYNTHETIC";
}

/**
 * @param {object|null|undefined} horizonData - CALPINAGE_STATE.horizonMask.data (mask + horizon + meta + dataCoverage)
 * @param {object} normalized - sortie normalizeCalpinageShading (sera muté)
 * @returns {object} normalized
 */
export function enrichNormalizedShadingFromHorizon(horizonData, normalized) {
  if (!normalized || typeof normalized !== "object") return normalized;
  if (!horizonData || typeof horizonData !== "object") return normalized;

  const hasHorizon = Array.isArray(horizonData.horizon) && horizonData.horizon.length > 0;
  const hasMask = Array.isArray(horizonData.mask) && horizonData.mask.length > 0;
  if (!hasHorizon && !hasMask) return normalized;

  const dc = horizonData.dataCoverage && typeof horizonData.dataCoverage === "object" ? horizonData.dataCoverage : {};
  const hm = horizonData.meta && typeof horizonData.meta === "object" ? horizonData.meta : {};

  let provider = dc.provider;
  if (!provider && hm.providerType) provider = hm.providerType;
  if (!provider) provider = hm.source;
  if (typeof provider !== "string" || provider.length === 0) {
    provider = "RELIEF_ONLY";
  }

  const farHorizonKind = farHorizonKindFromProvider(provider);

  const prevFar = normalized.far && typeof normalized.far === "object" ? normalized.far : {};
  const far = {
    ...prevFar,
    source: provider,
    farHorizonKind,
  };
  if (Object.keys(dc).length > 0) {
    far.dataCoverage = { ...dc };
  }
  if (hm.fallbackReason || hm.requestedSurfaceProvider) {
    far.horizonMeta = {
      fallbackReason: hm.fallbackReason ?? null,
      requestedSurfaceProvider: hm.requestedSurfaceProvider ?? null,
    };
  }

  let confidence = "LOW";
  if (provider === "IGN_RGE_ALTI") confidence = "HIGH";
  else if (provider === "HTTP_GEOTIFF" || REAL_TERRAIN_PROVIDERS.has(provider)) confidence = "MEDIUM";

  const prevSq = normalized.shadingQuality && typeof normalized.shadingQuality === "object" ? normalized.shadingQuality : {};
  const shadingQuality = { ...prevSq };
  if (!shadingQuality.blockingReason) {
    shadingQuality.provider = provider;
    shadingQuality.farHorizonKind = farHorizonKind;
    shadingQuality.modelType =
      farHorizonKind === "REAL_TERRAIN" ? "DSM" : farHorizonKind === "UNAVAILABLE" ? "UNAVAILABLE" : "SYNTHETIC";
    if (!shadingQuality.confidence) shadingQuality.confidence = confidence;
    if (dc.gridResolutionMeters != null && shadingQuality.resolutionMeters == null) {
      shadingQuality.resolutionMeters = dc.gridResolutionMeters;
    }
    if (dc.effectiveRadiusMeters != null && shadingQuality.effectiveRadiusMeters == null) {
      shadingQuality.effectiveRadiusMeters = dc.effectiveRadiusMeters;
    }
  }

  normalized.far = far;
  normalized.farSource = provider;
  normalized.shadingQuality = shadingQuality;
  return normalized;
}
