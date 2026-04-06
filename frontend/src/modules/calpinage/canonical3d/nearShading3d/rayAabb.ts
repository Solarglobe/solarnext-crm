/**
 * Intersection rayon ↔ AABB (slabs) — préfiltrage broad-phase.
 */

import type { Vector3 } from "../types/primitives";
import type { AxisAlignedBounds3D } from "../types/volumetric-mesh";

const EPS = 1e-12;

/**
 * Vrai si le rayon `origin + t * dir` (dir non nécessairement unitaire) intersecte l’AABB pour un t ∈ [tMin, tMax].
 */
export function rayAabbIntersects(
  origin: Vector3,
  dir: Vector3,
  bounds: AxisAlignedBounds3D,
  tMin: number,
  tMax: number
): boolean {
  let t0 = tMin;
  let t1 = tMax;
  const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  for (const ax of axes) {
    const o = origin[ax];
    const d = dir[ax];
    const bn = bounds.min[ax];
    const bx = bounds.max[ax];
    if (Math.abs(d) < EPS) {
      if (o < bn || o > bx) return false;
      continue;
    }
    const invD = 1 / d;
    let tNear = (bn - o) * invD;
    let tFar = (bx - o) * invD;
    if (tNear > tFar) {
      const tmp = tNear;
      tNear = tFar;
      tFar = tmp;
    }
    t0 = Math.max(t0, tNear);
    t1 = Math.min(t1, tFar);
    if (t0 > t1) return false;
  }
  return true;
}
