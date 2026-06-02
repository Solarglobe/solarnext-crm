/**
 * CP-FAR-PVGIS-01 — Provider horizon PVGIS (fallback mondial)
 * Source : SRTM ~90m via PVGIS JRC Commission Européenne
 * Endpoint : https://re.jrc.ec.europa.eu/api/v5_3/printhorizon
 * Sortie : 48 azimuts, pas 7.5°, format { az, elev }[]
 * Confidence : 0.55 (données réelles terrain, résolution limitée)
 * Aucune clé API requise. Rate limit : 30 req/s.
 */

const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_3/printhorizon";
const PVGIS_TIMEOUT_MS = 8000;

/**
 * PVGIS couvre l'Europe, l'Afrique, l'Asie et les Amériques (-65 à +75° lat).
 * @param {{ lat: number, lon: number }} params
 * @returns {{ available: boolean, notes: string[] }}
 */
export function isAvailable({ lat, lon }) {
  const inRange =
    typeof lat === "number" && typeof lon === "number" &&
    lat >= -65 && lat <= 75 &&
    lon >= -180 && lon <= 180;
  return {
    available: inRange,
    notes: inRange ? [] : ["Coordonnées hors couverture PVGIS"],
  };
}

/**
 * Calcule le masque d'horizon via PVGIS.
 * @param {{ lat: number, lon: number }} params
 * @returns {Promise<{ source, mask, step_deg, radius_m, confidence, dataCoverage, meta }>}
 * @throws {Error} si PVGIS est indisponible ou retourne une réponse invalide
 */
export async function computeMask({ lat, lon }) {
  const url = `${PVGIS_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&outputformat=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`PVGIS HTTP ${res.status} pour lat=${lat} lon=${lon}`);
  }

  const data = await res.json();

  if (!Array.isArray(data?.outputs?.horizon_profile) || data.outputs.horizon_profile.length === 0) {
    throw new Error("PVGIS: réponse inattendue — horizon_profile absent ou vide");
  }

  const mask = data.outputs.horizon_profile.map((p) => ({
    az: Number(p.A),
    elev: Math.max(0, Number(p.H_hor) || 0),
  }));

  return {
    source: "SURFACE_DSM",
    mask,
    step_deg: 7.5,
    radius_m: null,
    confidence: 0.55,
    dataCoverage: {
      provider: "PVGIS_HORIZON",
      ratio: 1,
      gridResolutionMeters: 90,
      effectiveRadiusMeters: null,
      notes: ["SRTM ~90m via PVGIS JRC — Commission Européenne — fallback mondial"],
    },
    meta: {
      source: "PVGIS_HORIZON",
      algorithm: "PVGIS_BUILT_IN",
      qualityScore: 0.55,
    },
  };
}
