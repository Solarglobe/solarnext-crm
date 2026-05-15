/**
 * Wrapper frontend pour nearShadingCore.cjs (chargé via script).
 * Adapte les données calpinage (panels, obstacles polygonPx) au format attendu
 * et appelle computeNearShading avec sunVectors + getZWorldAtXY.
 *
 * Parité backend : pour comparer avec backend (calpinageShading.service),
 * utiliser la même config : { year: 2026, stepMinutes: 60, minSunElevationDeg: 3 }.
 * Le backend utilise 9 points par panneau (3x3) ; nearShadingCore en mode parité
 * utilise panelGridSize: 2 (3x3) — voir tests near-shading-front-back-parity.test.js.
 *
 * Near officiel : sélection centralisée dans `integration/nearShadingOfficialSelection.ts`
 * (3D first si valide, sinon legacy explicite).
 */

import {
  attemptCanonicalNearShading,
  mergeOfficialNearShading,
} from "../integration/nearShadingOfficialSelection";
import { CANONICAL_3D_NEAR_SHADING_ENABLED } from "../integration/canonicalNearShadingFlags";
import {
  logOnceIfUiNearUsedExperimentalCanonical,
  warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend,
} from "./shadingGovernance";
import type {
  ComputeNearShadingFrontendParams,
  ComputeNearShadingFrontendResult,
  NearShadingConfig,
} from "./nearShadingTypes";
import type { ObstacleInput, PanelInput } from "./shadingInputTypes";
import { getCalpinageRuntime } from "../runtime/calpinageRuntime";

export type {
  ComputeNearShadingFrontendParams,
  ComputeNearShadingFrontendResult,
  NearShadingConfig,
  NearShadingPanelResult,
  ObstacleInput,
  PanelInput,
} from "./nearShadingTypes";

function computeNearShadingLegacy(
  params: ComputeNearShadingFrontendParams
): Omit<ComputeNearShadingFrontendResult, "officialNear"> {
  const {
    panels,
    obstacles,
    latitude,
    longitude,
    config = {},
    getHeightAtImagePoint,
    useZLocal = typeof getHeightAtImagePoint === "function",
    metersPerPixel,
    debug = false,
  } = params;

  const emptyResult: Omit<ComputeNearShadingFrontendResult, "officialNear"> = {
    totalLossPct: 0,
    perPanel: panels.map((p) => ({
      panelId: p.id,
      shadedFractionAvg: 0,
      lossPct: 0,
    })),
  };

  if (!panels.length) return emptyResult;

  const rt = getCalpinageRuntime();
  const getAnnualSunVectors =
    (rt?.getAnnualSunVectors?.() as Window["getAnnualSunVectors"] | undefined) ??
    (typeof window !== "undefined" ? window.getAnnualSunVectors : undefined);
  const core =
    (rt?.getNearShadingCore?.() as Window["nearShadingCore"] | undefined) ??
    (typeof window !== "undefined" ? window.nearShadingCore : undefined);

  if (typeof getAnnualSunVectors !== "function" || !core?.computeNearShading) {
    if (debug) {
      console.warn(
        "[nearShadingWrapper] getAnnualSunVectors ou nearShadingCore absent, retour 0"
      );
    }
    return emptyResult;
  }

  const sunVectors = getAnnualSunVectors(latitude, longitude, {
    year: config.year ?? new Date().getFullYear(),
    stepMinutes: config.stepMinutes ?? 60,
    minSunElevationDeg: config.minSunElevationDeg ?? 3,
  });

  if (!sunVectors.length) return emptyResult;

  const getZWorldAtXY =
    typeof getHeightAtImagePoint === "function"
      ? (x: number, y: number) => getHeightAtImagePoint({ x, y })
      : undefined;

  const mpp =
    typeof metersPerPixel === "number" &&
    metersPerPixel > 0 &&
    Number.isFinite(metersPerPixel)
      ? metersPerPixel
      : 1;

  return core.computeNearShading({
    panels,
    obstacles,
    sunVectors,
    getZWorldAtXY,
    useZLocal,
    metersPerPixel: mpp,
    debug,
  });
}

/**
 * Calcule la perte near shading : legacy toujours exécuté (référence),
 * puis sélection officielle canonical 3D vs legacy (voir `mergeOfficialNearShading`).
 */
export function computeNearShadingFrontend(
  params: ComputeNearShadingFrontendParams
): ComputeNearShadingFrontendResult {
  warnOnceIfExperimentalNearCanonicalMayDivergeFromBackend(CANONICAL_3D_NEAR_SHADING_ENABLED);
  const legacy = computeNearShadingLegacy(params);
  const attempt = attemptCanonicalNearShading(params);
  const out = mergeOfficialNearShading(legacy, attempt, params.panels);
  logOnceIfUiNearUsedExperimentalCanonical(out.officialNear?.engine);
  return out;
}

declare global {
  interface Window {
    getAnnualSunVectors?: (
      latDeg: number,
      lonDeg: number,
      config: NearShadingConfig
    ) => Array<{ dx: number; dy: number; dz: number }>;
    nearShadingCore?: {
      computeNearShading: (params: {
        panels: PanelInput[];
        obstacles: ObstacleInput[];
        sunVectors: Array<{ dx: number; dy: number; dz: number }>;
        getZWorldAtXY?: (x: number, y: number) => number;
        useZLocal?: boolean;
        metersPerPixel?: number;
        debug?: boolean;
      }) => Omit<ComputeNearShadingFrontendResult, "officialNear">;
    };
  }
}
