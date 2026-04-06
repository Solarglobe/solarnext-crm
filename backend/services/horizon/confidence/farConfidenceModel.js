/**
 * CP-FAR-010 — Modèle de confiance dynamique (Far Shading)
 * Module pur, testable isolément. N'influence pas le calcul de perte.
 */

/**
 * @param {Object} params
 * @param {string} params.source - RELIEF_ONLY | SURFACE_DSM
 * @param {string} [params.algorithm] - LEGACY | RAYCAST_HD
 * @param {number} [params.gridResolutionMeters]
 * @param {number} [params.maxDistanceMeters]
 * @param {number} [params.stepDeg]
 * @param {number} [params.dataCoverageRatio] - 0..1
 * @param {number[]} [params.obstacleDistancesMeters]
 * @param {boolean} [params.hasRealDSM]
 * @returns {{ score: number, level: string, breakdown: object }}
 */
export function computeFarConfidence(params) {
  const {
    source = "RELIEF_ONLY",
    algorithm = "LEGACY",
    gridResolutionMeters = 30,
    maxDistanceMeters = 500,
    stepDeg = 2,
    dataCoverageRatio = 1,
    obstacleDistancesMeters = [],
    hasRealDSM = false,
  } = params;

  const breakdown = {
    resolutionWeight: 0,
    coverageWeight: 0,
    geometryWeight: 0,
    algorithmWeight: 0,
  };

  // A) Source & Algorithme (max 25 pts)
  let algorithmWeight = 0;
  if (source === "RELIEF_ONLY" || source === "SYNTHETIC_STUB") {
    algorithmWeight = 40;
  } else if (source === "SURFACE_DSM" && algorithm === "LEGACY") {
    algorithmWeight = 60;
  } else if (source === "SURFACE_DSM" && algorithm === "RAYCAST_HD") {
    algorithmWeight = 75;
  } else {
    algorithmWeight = 50;
  }
  breakdown.algorithmWeight = Math.min(25, algorithmWeight);

  // B) Résolution DSM (max 20 pts)
  let resolutionWeight = 0;
  if (source === "RELIEF_ONLY" || source === "SYNTHETIC_STUB") {
    resolutionWeight = 0;
  } else if (gridResolutionMeters <= 5) {
    resolutionWeight = 20;
  } else if (gridResolutionMeters <= 10) {
    resolutionWeight = 15;
  } else if (gridResolutionMeters <= 20) {
    resolutionWeight = 10;
  } else if (gridResolutionMeters <= 30) {
    resolutionWeight = 5;
  }
  breakdown.resolutionWeight = resolutionWeight;

  // C) Couverture effective (max 25 pts)
  let coverageWeight = 0;
  const ratio = Math.max(0, Math.min(1, dataCoverageRatio));
  if (ratio >= 0.95) coverageWeight = 25;
  else if (ratio >= 0.85) coverageWeight = 20;
  else if (ratio >= 0.7) coverageWeight = 15;
  else if (ratio >= 0.5) coverageWeight = 8;
  breakdown.coverageWeight = coverageWeight;

  // D) Géométrie / Distance obstacles (max 20 pts)
  let geometryWeight = 0;
  if (Array.isArray(obstacleDistancesMeters) && obstacleDistancesMeters.length > 0) {
    const sum = obstacleDistancesMeters.reduce((a, b) => a + b, 0);
    const avgDist = sum / obstacleDistancesMeters.length;
    if (avgDist < 100) geometryWeight = 20;
    else if (avgDist < 300) geometryWeight = 15;
    else if (avgDist < 800) geometryWeight = 10;
    else geometryWeight = 5;
  } else {
    geometryWeight = 8;
  }
  breakdown.geometryWeight = geometryWeight;

  // E) Step angular (max 10 pts)
  let stepWeight = 0;
  if (stepDeg <= 0.5) stepWeight = 10;
  else if (stepDeg <= 1) stepWeight = 7;
  else stepWeight = 3;

  let score =
    breakdown.algorithmWeight +
    breakdown.resolutionWeight +
    breakdown.coverageWeight +
    breakdown.geometryWeight +
    stepWeight;
  score = Math.min(100, score);

  if (source === "RELIEF_ONLY" || source === "SYNTHETIC_STUB") {
    score = Math.min(30, score);
  }

  let level = "LOW";
  if (score >= 85) level = "VERY_HIGH";
  else if (score >= 70) level = "HIGH";
  else if (score >= 50) level = "MEDIUM";

  if (source === "RELIEF_ONLY" || source === "SYNTHETIC_STUB") {
    level = "LOW";
  }

  return {
    score,
    level,
    breakdown: {
      ...breakdown,
      stepWeight,
    },
  };
}
