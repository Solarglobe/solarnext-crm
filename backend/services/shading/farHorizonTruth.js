/**
 * POINT 6C — Vérité officielle far horizon : terrain réel vs synthétique (métadonnées uniquement).
 */

export const REAL_TERRAIN_PROVIDERS = new Set(["IGN_RGE_ALTI", "HTTP_GEOTIFF", "DSM_REAL"]);

/**
 * @param {string|null|undefined} provider - dataCoverage.provider / far.source
 * @returns {"REAL_TERRAIN"|"SYNTHETIC"|"UNAVAILABLE"}
 */
export function farHorizonKindFromProvider(provider) {
  if (provider === "UNAVAILABLE_NO_GPS") return "UNAVAILABLE";
  return typeof provider === "string" && REAL_TERRAIN_PROVIDERS.has(provider) ? "REAL_TERRAIN" : "SYNTHETIC";
}
