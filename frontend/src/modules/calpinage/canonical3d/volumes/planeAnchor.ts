/**
 * Projection sur plans de pans et résolution du pan porteur pour volumes roof-aware.
 */

import type { PlaneEquation } from "../types/plane";
import type { WorldPosition3D } from "../types/coordinates";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { Vector3 } from "../types/primitives";
import { dot3, scale3, sub3 } from "../utils/math3";

/** Distance signée au plan (n unitaire) : n·p + d. */
export function signedDistanceToPlane(point: Vector3, eq: PlaneEquation): number {
  return dot3(eq.normal, point) + eq.d;
}

/** Projection orthogonale du point sur le plan. */
export function projectPointOntoPlane(point: Vector3, eq: PlaneEquation): WorldPosition3D {
  const sd = signedDistanceToPlane(point, eq);
  const p = sub3(point, scale3(eq.normal, sd));
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Intersection du plan `n·p + d = 0` avec la droite verticale {(x, y, t), t ∈ ℝ}.
 * Même hauteur qu’utiliserait un positionnement « sur le plan » avec (x,y) fixés — aligné avec
 * `resolveCenterOnPlaneWorld` / maillage toit par patch (équation du `RoofPlanePatch3D`).
 */
export function zOnPlaneEquationAtFixedXY(eq: PlaneEquation, x: number, y: number, epsNz = 1e-6): number | null {
  const nz = eq.normal.z;
  if (!Number.isFinite(nz) || Math.abs(nz) < epsNz) return null;
  const z = -(eq.normal.x * x + eq.normal.y * y + eq.d) / nz;
  return Number.isFinite(z) ? z : null;
}

export function projectFootprintOntoPlane(
  points: readonly WorldPosition3D[],
  eq: PlaneEquation
): { projected: WorldPosition3D[]; maxAbsDistanceM: number } {
  let maxD = 0;
  const projected: WorldPosition3D[] = [];
  for (const p of points) {
    const sd = Math.abs(signedDistanceToPlane(p, eq));
    maxD = Math.max(maxD, sd);
    projected.push(projectPointOntoPlane(p, eq));
  }
  return { projected, maxAbsDistanceM: maxD };
}

/**
 * Pose une empreinte sur le plan sans changer son ancrage horizontal.
 * Contrairement à la projection orthogonale, cette fonction conserve strictement X/Y et ne modifie que Z.
 */
export function projectFootprintOntoPlaneAtFixedXY(
  points: readonly WorldPosition3D[],
  eq: PlaneEquation
): { projected: WorldPosition3D[]; maxAbsDistanceM: number } {
  let maxD = 0;
  const projected: WorldPosition3D[] = [];
  for (const p of points) {
    const sd = Math.abs(signedDistanceToPlane(p, eq));
    maxD = Math.max(maxD, sd);
    const z = zOnPlaneEquationAtFixedXY(eq, p.x, p.y);
    projected.push({ x: p.x, y: p.y, z: z ?? p.z });
  }
  return { projected, maxAbsDistanceM: maxD };
}

/**
 * Résout le premier `RoofPlanePatch3D` dont l’id figure dans `relatedPlanePatchIds` et `candidates`.
 */
export function resolvePlanePatchByRelatedIds(
  relatedPlanePatchIds: readonly string[] | undefined,
  candidates: readonly RoofPlanePatch3D[] | undefined
): RoofPlanePatch3D | null {
  if (!candidates?.length || !relatedPlanePatchIds?.length) return null;
  const set = new Set(relatedPlanePatchIds);
  for (const p of candidates) {
    if (set.has(p.id)) return p;
  }
  return null;
}
