/**
 * CP-FAR-007 — ReliefOnly Horizon Provider
 * Réutilise computeHorizonMaskReliefOnly.
 */

import {
  computeHorizonMaskReliefOnly,
  validateHorizonMaskParams,
} from "../horizonMaskCore.js";

export function getMode() {
  return "RELIEF_ONLY";
}

/**
 * @param {{ lat: number, lon: number, radius_m: number }} params
 * @returns {{ available: boolean, coveragePct: number, resolution_m: number|null, notes: string[] }}
 */
export function isAvailable(params) {
  return {
    available: true,
    coveragePct: 1,
    resolution_m: 25,
    notes: [],
  };
}

/**
 * @param {{ lat: number, lon: number, radius_m: number, step_deg: number }} params
 * @returns {{ source, radius_m, step_deg, resolution_m, mask, confidence, dataCoverage }}
 */
export function computeMask(params) {
  validateHorizonMaskParams(params);
  const result = computeHorizonMaskReliefOnly(params);
  return {
    ...result,
    dataCoverage: {
      mode: "RELIEF_ONLY",
      available: true,
      coveragePct: 1,
      notes: [],
      ratio: 1,
      effectiveRadiusMeters: result.radius_m,
      gridResolutionMeters: result.resolution_m,
      provider: "RELIEF_ONLY",
    },
    meta: {
      source: "RELIEF_ONLY",
      qualityScore: 0.3,
    },
  };
}
