/**
 * Chaîne unique image → ENU monde → physique pan (Prompt 4B).
 * Doit rester strictement aligné sur `worldMapping.imagePxToWorldHorizontalM` + `officialPanPhysics`.
 *
 * SYNC : toute logique parallèle dans `pans-bundle.js` doit reproduire ces formules.
 */

import type { Vector3 } from "../types/primitives";
import { normalize3, vec3 } from "../utils/math3";
import {
  azimuthDegEnuHorizontalNormal,
  orientExteriorNormalTowardSky,
  tiltDegFromNormalAndUp,
} from "./planePolygon3d";
import { imagePxToWorldHorizontalM } from "./worldMapping";
import {
  computeOfficialPanPhysicsFromCornersWorld,
  type OfficialPanPhysicsModel,
} from "./officialPanPhysics";

const EPS = 1e-10;

/**
 * Moindres carrés z = a·x + b·y + c sur points monde (x,y horizontal ENU, z altitude m).
 */
export function fitPlaneWorldLeastSquares(samples: readonly Vector3[]): { a: number; b: number; c: number } | null {
  const m = samples.length;
  if (m < 3) return null;
  let sumX = 0,
    sumY = 0,
    sumH = 0,
    sumXX = 0,
    sumYY = 0,
    sumXY = 0,
    sumXH = 0,
    sumYH = 0;
  for (let i = 0; i < m; i++) {
    const xM = samples[i].x;
    const yM = samples[i].y;
    const h = samples[i].z;
    sumX += xM;
    sumY += yM;
    sumH += h;
    sumXX += xM * xM;
    sumYY += yM * yM;
    sumXY += xM * yM;
    sumXH += xM * h;
    sumYH += yM * h;
  }
  const det =
    m * (sumXX * sumYY - sumXY * sumXY) -
    sumX * (sumX * sumYY - sumXY * sumY) +
    sumY * (sumX * sumXY - sumXX * sumY);
  if (Math.abs(det) < EPS) return null;
  const a =
    (m * (sumXH * sumYY - sumYH * sumXY) - sumX * (sumH * sumYY - sumYH * sumY) + sumY * (sumH * sumXY - sumXH * sumY)) /
    det;
  const b =
    (m * (sumXX * sumYH - sumXH * sumXY) - sumX * (sumXX * sumH - sumXH * sumX) + sumY * (sumXY * sumX - sumXX * sumY)) /
    det;
  const c = (sumH - a * sumX - b * sumY) / m;
  return { a, b, c };
}

/** Pente + azimut ENU depuis un plan h(x,y) moindres carrés (repli si < 3 sommets avec Z). */
export function tryPanPhysicsFromWorldHeightSamples(
  samples: readonly Vector3[],
  upWorld: Vector3 = vec3(0, 0, 1),
): { slopeDeg: number; azimuthDeg: number; normal: Vector3 } | null {
  const plane = fitPlaneWorldLeastSquares(samples);
  if (!plane) return null;
  const nRaw: Vector3 = { x: -plane.a, y: -plane.b, z: 1 };
  const exterior = orientExteriorNormalTowardSky(nRaw, upWorld);
  const exteriorU = normalize3(exterior);
  if (!exteriorU) return null;
  return {
    slopeDeg: tiltDegFromNormalAndUp(exteriorU, upWorld),
    azimuthDeg: azimuthDegEnuHorizontalNormal(exteriorU),
    normal: { x: exteriorU.x, y: exteriorU.y, z: exteriorU.z },
  };
}

/**
 * Sommets monde (Z = h m) pour chaque sommet image, si **toutes** les hauteurs sont finies.
 */
export function buildCornersWorldFromImageVertices(
  vertices: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  getZ: (pt: { x: number; y: number }, index: number) => number | null,
  metersPerPixel: number,
  northAngleDeg: number,
): Vector3[] | null {
  const corners: Vector3[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const z = getZ(vertices[i], i);
    if (z == null || !Number.isFinite(z)) return null;
    const w = imagePxToWorldHorizontalM(vertices[i].x, vertices[i].y, metersPerPixel, northAngleDeg);
    corners.push({ x: w.x, y: w.y, z });
  }
  if (corners.length < 3) return null;
  return corners;
}

/**
 * Physique officielle : même résultat que `computeOfficialPanPhysicsFromCornersWorld`
 * sur les sommets monde dérivés par `imagePxToWorldHorizontalM` + Z sommet.
 */
export function computeOfficialPanPhysicsFromImageVertices(
  vertices: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  getZ: (pt: { x: number; y: number }, index: number) => number | null,
  metersPerPixel: number,
  northAngleDeg: number,
  upWorld: Vector3 = vec3(0, 0, 1),
): OfficialPanPhysicsModel {
  const corners = buildCornersWorldFromImageVertices(vertices, getZ, metersPerPixel, northAngleDeg);
  if (!corners) {
    return computeOfficialPanPhysicsFromCornersWorld([], upWorld);
  }
  return computeOfficialPanPhysicsFromCornersWorld(corners, upWorld);
}

/** Échantillons monde pour sommets dont Z est finie (ordre conservé). */
export function collectPartialWorldHeightSamplesFromImage(
  vertices: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  getZ: (pt: { x: number; y: number }, index: number) => number | null,
  metersPerPixel: number,
  northAngleDeg: number,
): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const z = getZ(vertices[i], i);
    if (z == null || !Number.isFinite(z)) continue;
    const w = imagePxToWorldHorizontalM(vertices[i].x, vertices[i].y, metersPerPixel, northAngleDeg);
    out.push({ x: w.x, y: w.y, z });
  }
  return out;
}
