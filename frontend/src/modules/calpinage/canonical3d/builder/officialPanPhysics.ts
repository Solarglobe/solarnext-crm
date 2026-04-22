/**
 * Physique officielle pan toiture (Prompt 4) — unique source de définition TS pour :
 * pente, azimut, sens de descente, normale, à partir de sommets 3D monde fiables.
 *
 * Aligné sur `planePolygon3d` (Newell + conventions ENU Z↑), même esprit que
 * `finalizeCanonicalPan3DFromMutable` dans `buildCanonicalPans3DFromRuntime.ts`.
 */

import type { Vector3 } from "../types/primitives";
import { normalize3, vec3 } from "../utils/math3";
import {
  centroid3,
  newellNormalUnnormalized,
  orientExteriorNormalTowardSky,
  planeFitResidualRms,
  tiltDegFromNormalAndUp,
  azimuthDegEnuHorizontalNormal,
} from "./planePolygon3d";

const EPS = 1e-10;

export type OfficialPanPhysicsSource = "newell_corners_world" | "degenerate" | "insufficient_vertices";

export type OfficialPanPhysicsModel = {
  /** Angle surface / horizontal (0° = plat). */
  readonly slopeDeg: number | null;
  /** Azimut ENU de la composante horizontale de la normale extérieure (0=N, 90=E). */
  readonly azimuthDeg: number | null;
  /**
   * Unitaire horizontal ENU (x Est, y Nord) : direction de la plus forte descente
   * (opposée à la projection horizontale de la normale sortante).
   */
  readonly fallDirectionEnu: { readonly x: number; readonly y: number } | null;
  /** Normale unitaire sortante « vers le ciel ». */
  readonly normal: Vector3;
  readonly planeResidualRmsM: number | null;
  readonly confidence: number;
  readonly source: OfficialPanPhysicsSource;
};

function horizontalFallFromExteriorNormal(n: Vector3): { x: number; y: number } | null {
  const nu = normalize3(n);
  if (!nu) return null;
  const h = Math.hypot(nu.x, nu.y);
  if (h < EPS) return null;
  return { x: -nu.x / h, y: -nu.y / h };
}

/**
 * Azimut (deg) de la direction de descente en ENU : 0=N, 90=E.
 */
export function azimuthDegOfFallDirectionEnu(fall: { x: number; y: number }): number {
  return ((Math.atan2(fall.x, fall.y) * 180) / Math.PI + 360) % 360;
}

/**
 * Entrée autoritaire : polygone 3D fermé (repère monde ENU, Z vertical m).
 * @param cornersWorld — au moins 3 sommets ; ordre = bord du pan.
 */
export function computeOfficialPanPhysicsFromCornersWorld(
  cornersWorld: readonly Vector3[],
  upWorld: Vector3 = vec3(0, 0, 1),
): OfficialPanPhysicsModel {
  const nVert = cornersWorld.length;
  if (nVert < 3) {
    return {
      slopeDeg: null,
      azimuthDeg: null,
      fallDirectionEnu: null,
      normal: { x: 0, y: 0, z: 1 },
      planeResidualRmsM: null,
      confidence: 0,
      source: "insufficient_vertices",
    };
  }

  const nRaw = newellNormalUnnormalized(cornersWorld);
  const nLen = Math.hypot(nRaw.x, nRaw.y, nRaw.z);
  if (nLen < EPS) {
    return {
      slopeDeg: null,
      azimuthDeg: null,
      fallDirectionEnu: null,
      normal: { x: 0, y: 0, z: 1 },
      planeResidualRmsM: null,
      confidence: 0,
      source: "degenerate",
    };
  }

  const exterior = orientExteriorNormalTowardSky(nRaw, upWorld);
  const exteriorU = normalize3(exterior) ?? { x: 0, y: 0, z: 1 };
  const c = centroid3(cornersWorld);
  const planeResidualRmsM = planeFitResidualRms(cornersWorld, exteriorU, c);

  const slopeDeg = tiltDegFromNormalAndUp(exteriorU, upWorld);
  const azimuthDeg = azimuthDegEnuHorizontalNormal(exteriorU);
  const fall = horizontalFallFromExteriorNormal(exteriorU);

  let confidence = 0.92;
  if (planeResidualRmsM != null && planeResidualRmsM > 0.05) confidence -= 0.15;
  if (planeResidualRmsM != null && planeResidualRmsM > 0.25) confidence -= 0.25;
  if (slopeDeg <= 0.75) confidence = Math.min(confidence, 0.88);

  return {
    slopeDeg,
    azimuthDeg,
    fallDirectionEnu: fall,
    normal: { x: exteriorU.x, y: exteriorU.y, z: exteriorU.z },
    planeResidualRmsM,
    confidence: Math.max(0, Math.min(1, confidence)),
    source: "newell_corners_world",
  };
}
