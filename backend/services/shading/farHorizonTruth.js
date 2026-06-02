/**
 * POINT 6C — Vérité officielle far horizon : terrain réel vs synthétique (métadonnées uniquement).
 */

export const REAL_TERRAIN_PROVIDERS = new Set([
  "IGN_RGE_ALTI",
  "HTTP_GEOTIFF",
  "DSM_REAL",
  "IGN_GEOPLATEFORME",  // IGN Géoplateforme API (ign_rge_alti_wld)
  "PVGIS_HORIZON",      // PVGIS JRC (SRTM ~90m)
]);

/**
 * @param {string|null|undefined} provider - dataCoverage.provider / far.source
 * @returns {"REAL_TERRAIN"|"SYNTHETIC"|"UNAVAILABLE"}
 */
export function farHorizonKindFromProvider(provider) {
  if (provider === "UNAVAILABLE_NO_GPS" || provider === "FAR_UNAVAILABLE_ERROR") return "UNAVAILABLE";
  return typeof provider === "string" && REAL_TERRAIN_PROVIDERS.has(provider) ? "REAL_TERRAIN" : "SYNTHETIC";
}
