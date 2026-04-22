/**
 * Résolution Z toit en (x,y) : équation de plan `RoofPlanePatch3D` (`zOnPlaneEquationAtFixedXY` dans `planeAnchor`),
 * alignée sur `resolveCenterOnPlaneWorld` / pose panneaux.
 *
 * - **`resolveRoofPlaneZAtXYFromPatches`** (shell, diagnostics) : emprise contient `(x,y)` → min(Z) si chevauchement ;
 *   sinon fallback = plan du patch d’empreinte XY la plus proche, **toujours au (x,y) query** (pas de snap bord).
 * - **`resolveShellContourVertexWorldXYAndZ`** : ancien mode avec recalage XY sur le bord (usages hors shell).
 */

import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { WorldPosition3D } from "../types/coordinates";
import { zOnPlaneEquationAtFixedXY } from "../volumes/planeAnchor";

/**
 * Distance max (m) du point contour au bord d’empreinte du pan retenu ; au-delà → pas de Z (shell non construit).
 */
export const SHELL_OUTSIDE_PAN_MAX_BOUNDARY_DISTANCE_M = 50;

function pointInPolygonXY(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if (!Number.isFinite(pi.x) || !Number.isFinite(pi.y) || !Number.isFinite(pj.x) || !Number.isFinite(pj.y)) continue;
    const intersect =
      pi.y !== pj.y && ((pi.y > y) !== (pj.y > y)) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Tolérance numérique uniquement (bords / sommets d’empreinte en flottants). */
const FOOTPRINT_ON_EDGE_EPS_M = 1e-9;
const FOOTPRINT_ON_EDGE_EPS2 = FOOTPRINT_ON_EDGE_EPS_M * FOOTPRINT_ON_EDGE_EPS_M;

function pointOnSegmentFootprintXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const c = closestPointOnSegmentXY(px, py, ax, ay, bx, by);
  return c.distSq <= FOOTPRINT_ON_EDGE_EPS2;
}

/** Point strictement intérieur **ou** sur le bord du polygone XY (fermé). */
function pointInOrOnPolygonFootprintXY(x: number, y: number, poly: readonly { x: number; y: number }[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    if (pointOnSegmentFootprintXY(x, y, a.x, a.y, b.x, b.y)) return true;
  }
  return pointInPolygonXY(x, y, poly);
}

function closestPointOnSegmentXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { readonly x: number; readonly y: number; readonly distSq: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-24 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const u = px - qx;
  const v = py - qy;
  return { x: qx, y: qy, distSq: u * u + v * v };
}

function distSqPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return closestPointOnSegmentXY(px, py, ax, ay, bx, by).distSq;
}

/** Plus proche point sur le cycle d’arêtes (fermé) du polygone XY. */
export function closestPointOnPolygonBoundaryXY(
  px: number,
  py: number,
  poly: readonly { x: number; y: number }[],
): { readonly x: number; readonly y: number; readonly distSq: number } | null {
  const n = poly.length;
  if (n < 2) return null;
  let bestX = poly[0]!.x;
  let bestY = poly[0]!.y;
  let bestD2 = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const c = closestPointOnSegmentXY(px, py, a.x, a.y, b.x, b.y);
    if (c.distSq < bestD2) {
      bestD2 = c.distSq;
      bestX = c.x;
      bestY = c.y;
    }
  }
  return { x: bestX, y: bestY, distSq: bestD2 };
}

function pointToPolygonDistanceSqXY(px: number, py: number, poly: readonly { x: number; y: number }[]): number {
  if (poly.length < 2) return Infinity;
  if (pointInPolygonXY(px, py, poly)) return 0;
  const c = closestPointOnPolygonBoundaryXY(px, py, poly);
  return c?.distSq ?? Infinity;
}

function zOnPatchPlaneAtXY(patch: RoofPlanePatch3D, x: number, y: number): number | null {
  return zOnPlaneEquationAtFixedXY(patch.equation, x, y);
}

export function patchFootprintXY(poly: readonly WorldPosition3D[]): { x: number; y: number }[] {
  return poly
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
    .map((c) => ({ x: c.x, y: c.y }));
}

export type ShellContourVertexRoofSnap = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Hauteur toit en **(x, y)** alignée sur les **plans** `RoofPlanePatch3D.equation` (même convention que
 * `resolveCenterOnPlaneWorld` / panneaux : surface = plan infini porté par le patch).
 *
 * 1. Empreinte XY (`cornersWorld`) contient `(x,y)` (intérieur ou bord) → Z = intersection verticale avec le plan ;
 *    plusieurs pans → **min(Z)** (pas de moyenne).
 * 2. Hors de toute emprise → Z sur le plan du patch dont l’empreinte est **la plus proche en distance XY**
 *    (point / polygone), toujours au **(x,y) query** — pas de snap sur le bord.
 */
export function resolveRoofPlaneZAtXYFromPatches(
  patches: readonly RoofPlanePatch3D[],
  x: number,
  y: number,
): number | null {
  let zBest = Infinity;
  for (const p of patches) {
    const footprint = patchFootprintXY(p.cornersWorld);
    if (footprint.length < 3) continue;
    if (!pointInOrOnPolygonFootprintXY(x, y, footprint)) continue;
    const z = zOnPatchPlaneAtXY(p, x, y);
    if (z != null && Number.isFinite(z)) zBest = Math.min(zBest, z);
  }
  if (zBest !== Infinity) return zBest;

  let bestPatch: RoofPlanePatch3D | null = null;
  let bestD2 = Infinity;
  for (const p of patches) {
    const footprint = patchFootprintXY(p.cornersWorld);
    if (footprint.length < 3) continue;
    const d2 = pointToPolygonDistanceSqXY(x, y, footprint);
    if (!Number.isFinite(d2)) continue;
    if (bestPatch == null || d2 < bestD2 - 1e-18) {
      bestD2 = d2;
      bestPatch = p;
    } else if (Math.abs(d2 - bestD2) <= 1e-12 * Math.max(1, bestD2) && String(p.id).localeCompare(String(bestPatch.id)) < 0) {
      bestPatch = p;
    }
  }
  if (bestPatch == null) return null;
  return zOnPatchPlaneAtXY(bestPatch, x, y);
}

export function resolveShellContourVertexWorldXYAndZ(
  patches: readonly RoofPlanePatch3D[],
  x: number,
  y: number,
): ShellContourVertexRoofSnap | null {
  const containing: RoofPlanePatch3D[] = [];
  for (const p of patches) {
    const footprint = patchFootprintXY(p.cornersWorld);
    if (footprint.length < 3) continue;
    if (!pointInPolygonXY(x, y, footprint)) continue;
    containing.push(p);
  }
  if (containing.length === 1) {
    const z = zOnPatchPlaneAtXY(containing[0]!, x, y);
    if (z == null || !Number.isFinite(z)) return null;
    return { x, y, z };
  }
  if (containing.length > 1) {
    let zMin = Infinity;
    for (const p of containing) {
      const z = zOnPatchPlaneAtXY(p, x, y);
      if (z != null && Number.isFinite(z)) zMin = Math.min(zMin, z);
    }
    if (zMin === Infinity) return null;
    return { x, y, z: zMin };
  }

  let bestPatch: RoofPlanePatch3D | null = null;
  let bestQx = 0;
  let bestQy = 0;
  let bestD2 = Infinity;
  for (const p of patches) {
    const footprint = patchFootprintXY(p.cornersWorld);
    const c = closestPointOnPolygonBoundaryXY(x, y, footprint);
    if (c == null) continue;
    const d2 = c.distSq;
    if (d2 < bestD2 - 1e-18) {
      bestD2 = d2;
      bestPatch = p;
      bestQx = c.x;
      bestQy = c.y;
    } else if (bestPatch != null && Math.abs(d2 - bestD2) <= 1e-12 * Math.max(1, bestD2)) {
      if (String(p.id).localeCompare(String(bestPatch.id)) < 0) {
        bestPatch = p;
        bestQx = c.x;
        bestQy = c.y;
      }
    }
  }
  if (bestPatch == null) return null;
  const maxM = SHELL_OUTSIDE_PAN_MAX_BOUNDARY_DISTANCE_M;
  if (Number.isFinite(maxM) && maxM >= 0 && bestD2 > maxM * maxM) return null;
  const z = zOnPatchPlaneAtXY(bestPatch, bestQx, bestQy);
  if (z == null || !Number.isFinite(z)) return null;
  return { x: bestQx, y: bestQy, z };
}

/** Même résolution Z que le shell et que l’échantillonnage toit cohérent patch (`resolveRoofPlaneZAtXYFromPatches`). */
export function resolveLocalRoofZAtXY(
  patches: readonly RoofPlanePatch3D[],
  x: number,
  y: number,
): number | null {
  return resolveRoofPlaneZAtXYFromPatches(patches, x, y);
}
