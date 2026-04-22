/**
 * Échantillonnage pur Z monde du toit principal sous un point image — à partir des patches planaires canoniques.
 * Ne dépend pas de `window` ni de CALPINAGE_STATE.
 */

import { pointInPolygon2d } from "../../../core/geometryCore2d.js";
import { imagePxToWorldHorizontalM } from "../../builder/worldMapping";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { RoofPlanePatch3D } from "../../types/roof-surface";

function solveZOnPlane(
  nx: number,
  ny: number,
  nz: number,
  d: number,
  x: number,
  y: number,
): number | null {
  if (!Number.isFinite(nz) || Math.abs(nz) < 1e-8) return null;
  return -(nx * x + ny * y + d) / nz;
}

/**
 * @returns Z monde (m) au point image, ou `null` si aucun pan ne contient la projection horizontale.
 */
export function sampleRoofZAtImagePxFromPatches(
  xPx: number,
  yPx: number,
  patches: readonly RoofPlanePatch3D[],
  world: CanonicalWorldConfig,
): number | null {
  if (!patches.length || !Number.isFinite(xPx) || !Number.isFinite(yPx)) return null;
  const { metersPerPixel, northAngleDeg } = world;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const w = imagePxToWorldHorizontalM(xPx, yPx, metersPerPixel, northAngleDeg);
  if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) return null;

  for (const p of patches) {
    const corners = p.cornersWorld;
    if (!corners || corners.length < 3) continue;
    const ring = corners.map((c) => ({ x: c.x, y: c.y }));
    if (!pointInPolygon2d({ x: w.x, y: w.y }, ring)) continue;
    const n = p.equation.normal;
    const z = solveZOnPlane(n.x, n.y, n.z, p.equation.d, w.x, w.y);
    if (z != null && Number.isFinite(z)) return z;
  }
  return null;
}
