/**
 * CP-FAR-001 — Horizon Mask Core (relief only)
 * Module pur, synthétique, sans données externes.
 * Prêt à être alimenté plus tard par MNT/LiDAR.
 */

const RESOLUTION_M = 25;
const BASE_ELEV_DEG = 1.5;
/** Plafonné — relief simplifié, ne pas présenter comme une mesure précise. */
const CONFIDENCE_SYNTHETIC = 0.3;

/**
 * Valide les paramètres d'entrée pour computeHorizonMaskReliefOnly.
 * @param {Object} params
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {number} params.radius_m
 * @param {number} params.step_deg
 * @throws {Error} si un paramètre est invalide
 */
export function validateHorizonMaskParams(params) {
  if (!params || typeof params !== "object") {
    throw new Error("params must be an object");
  }
  const { lat, lon, radius_m, step_deg } = params;

  if (typeof lat !== "number" || isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error("lat must be a number in [-90, 90]");
  }
  if (typeof lon !== "number" || isNaN(lon) || lon < -180 || lon > 180) {
    throw new Error("lon must be a number in [-180, 180]");
  }
  if (typeof radius_m !== "number" || isNaN(radius_m) || radius_m < 50 || radius_m > 5000) {
    throw new Error("radius_m must be a number in [50, 5000]");
  }
  if (typeof step_deg !== "number" || isNaN(step_deg) || step_deg < 0.5 || step_deg > 10) {
    throw new Error("step_deg must be a number in [0.5, 10]");
  }
}

/**
 * Calcule l'élévation synthétique pour un azimut donné (relief only, déterministe).
 * - Bump principal au Sud (az ~180), secondaire à l'Est (az ~90)
 * - Amplitude dépend faiblement de lat
 * - elev ∈ [0, 45]
 */
function syntheticElevationAtAzimuth(azDeg, lat) {
  const latFactor = 1 + lat / 10000;
  const ampSouth = 20 * latFactor;
  const ampEast = 12 * latFactor;
  const sigmaSouth = 45;
  const sigmaEast = 35;

  const distSouth = Math.min(
    Math.abs(azDeg - 180),
    Math.abs(azDeg - 180 + 360),
    Math.abs(azDeg - 180 - 360)
  );
  const distEast = Math.min(
    Math.abs(azDeg - 90),
    Math.abs(azDeg - 90 + 360),
    Math.abs(azDeg - 90 - 360)
  );

  const bumpSouth = ampSouth * Math.exp(-(distSouth * distSouth) / (2 * sigmaSouth * sigmaSouth));
  const bumpEast = ampEast * Math.exp(-(distEast * distEast) / (2 * sigmaEast * sigmaEast));

  let elev = BASE_ELEV_DEG + bumpSouth + bumpEast;
  elev = Math.max(0, Math.min(45, elev));
  return elev;
}

/**
 * Calcule un horizon mask à partir d'un modèle RELIEF ONLY (synthétique).
 * @param {Object} params
 * @param {number} params.lat - Latitude [-90, 90]
 * @param {number} params.lon - Longitude [-180, 180]
 * @param {number} params.radius_m - Rayon d'analyse [50, 5000]
 * @param {number} params.step_deg - Pas angulaire [1, 10]
 * @returns {Object} { source, radius_m, step_deg, resolution_m, mask, confidence }
 */
export function computeHorizonMaskReliefOnly(params) {
  validateHorizonMaskParams(params);

  const { lat, lon, radius_m, step_deg } = params;
  const numBins = Math.round(360 / step_deg);
  const mask = [];

  for (let i = 0; i < numBins; i++) {
    const az = (i * step_deg) % 360;
    const elev = syntheticElevationAtAzimuth(az, lat);
    mask.push({ az, elev });
  }

  return {
    source: "RELIEF_ONLY",
    radius_m,
    step_deg,
    resolution_m: RESOLUTION_M,
    mask,
    confidence: CONFIDENCE_SYNTHETIC,
  };
}

/**
 * Interpole l'élévation d'horizon pour un azimut arbitraire.
 * Gère le wrap 358→0.
 * @param {Array<{az:number, elev:number}>} mask
 * @param {number} azDeg - Azimut en degrés
 * @returns {number} Élévation interpolée en degrés
 */
function clampHorizonElevDeg(e) {
  if (typeof e !== "number" || !Number.isFinite(e)) return 0;
  return Math.max(-5, Math.min(90, e));
}

export function interpolateHorizonElevation(mask, azDeg) {
  if (!mask || !Array.isArray(mask) || mask.length === 0) {
    return 0;
  }

  const az = ((azDeg % 360) + 360) % 360;
  const step = mask.length >= 2 ? mask[1].az - mask[0].az : 360 / mask.length;

  if (mask.length === 1) {
    return clampHorizonElevDeg(mask[0].elev);
  }

  const idx = az / step;
  const i0 = Math.floor(idx) % mask.length;
  let i1 = (i0 + 1) % mask.length;

  const az0 = mask[i0].az;
  let az1 = mask[i1].az;
  if (i1 === 0) az1 = 360;

  const denom = az1 - az0;
  const t = denom === 0 || !Number.isFinite(denom) ? 0 : (az - az0) / denom;
  const elev0 = clampHorizonElevDeg(mask[i0].elev);
  const elev1 = clampHorizonElevDeg(mask[i1].elev);
  const out = elev0 + t * (elev1 - elev0);
  return clampHorizonElevDeg(out);
}
