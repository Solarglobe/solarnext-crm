/**
 * Enrichit un anneau contour monde (XY) avec les intersections des arêtes du contour
 * et les arêtes des emprise des pans — coupe aux frontières pan/pan pour limiter les cordes hors plan.
 */

import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { WorldPosition3D } from "../types/coordinates";

export type ShellContourRingXYPoint = { readonly x: number; readonly y: number };

function patchFootprintXY(poly: readonly WorldPosition3D[]): { x: number; y: number }[] {
  return poly
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
    .map((c) => ({ x: c.x, y: c.y }));
}

/** Arêtes fermées des empreintes XY (une entrée par côté de chaque pan). */
export function collectRoofPatchFootprintEdgesXY(
  patches: readonly RoofPlanePatch3D[],
): readonly { readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number }[] {
  const out: { ax: number; ay: number; bx: number; by: number }[] = [];
  for (const p of patches) {
    const poly = patchFootprintXY(p.cornersWorld);
    const m = poly.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % m]!;
      out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  return out;
}

const DEFAULT_T_EPS = 1e-9;
const DEFAULT_MERGE_T = 1e-8;

/**
 * Intersection stricte du segment ouvert ]A,B[ avec le segment fermé [P,Q].
 * `t` paramètre sur AB (0=A, 1=B).
 */
export function intersectOpenContourSegmentWithFootprintEdge2d(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
  qx: number,
  qy: number,
  tEps: number = DEFAULT_T_EPS,
): { readonly x: number; readonly y: number; readonly t: number } | null {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = qx - px;
  const sy = qy - py;
  const denom = rx * sy - ry * sx;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-14) return null;
  const qpx = px - ax;
  const qpy = py - ay;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t <= tEps || t >= 1 - tEps) return null;
  if (u < -1e-10 || u > 1 + 1e-10) return null;
  const x = ax + t * rx;
  const y = ay + t * ry;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, t };
}

function dedupeSortedTs(ts: number[], mergeEps: number): number[] {
  if (ts.length === 0) return [];
  const out: number[] = [ts[0]!];
  for (let i = 1; i < ts.length; i++) {
    const v = ts[i]!;
    if (v - out[out.length - 1]! > mergeEps) out.push(v);
  }
  return out;
}

export type EnrichShellContourRingOptions = {
  /** Écart minimal sur le paramètre t pour ignorer les intersections trop proches des sommets du contour. */
  readonly tEndpointEps?: number;
  /** Fusion des intersections quasi-dupliquées (même arête contour). */
  readonly mergeTEps?: number;
};

/**
 * @param ringXY anneau fermé (pas de répétition du premier point en fin).
 * @param patches pans toiture (empreintes = `cornersWorld` projetés XY).
 * @returns Nouvel anneau : mêmes sommets dans l’ordre, avec points insérés sur chaque arête aux croisements avec une arête d’empreinte.
 */
export function enrichShellContourRingWithPanFootprintIntersectionsXY(
  ringXY: readonly ShellContourRingXYPoint[],
  patches: readonly RoofPlanePatch3D[],
  options?: EnrichShellContourRingOptions,
): ShellContourRingXYPoint[] {
  const tEps = options?.tEndpointEps ?? DEFAULT_T_EPS;
  const mergeTEps = options?.mergeTEps ?? DEFAULT_MERGE_T;

  const n = ringXY.length;
  if (n < 3 || patches.length === 0) {
    return ringXY.map((p) => ({ x: p.x, y: p.y }));
  }

  const footprintEdges = collectRoofPatchFootprintEdgesXY(patches);
  if (footprintEdges.length === 0) {
    return ringXY.map((p) => ({ x: p.x, y: p.y }));
  }

  const out: ShellContourRingXYPoint[] = [];

  for (let i = 0; i < n; i++) {
    const A = ringXY[i]!;
    const B = ringXY[(i + 1) % n]!;
    out.push({ x: A.x, y: A.y });

    const lx = B.x - A.x;
    const ly = B.y - A.y;
    const L = Math.hypot(lx, ly);
    if (L < 1e-12) continue;

    const ts: number[] = [];
    for (const e of footprintEdges) {
      const hit = intersectOpenContourSegmentWithFootprintEdge2d(
        A.x,
        A.y,
        B.x,
        B.y,
        e.ax,
        e.ay,
        e.bx,
        e.by,
        tEps,
      );
      if (hit) ts.push(hit.t);
    }
    if (ts.length === 0) continue;

    ts.sort((a, b) => a - b);
    const uniq = dedupeSortedTs(ts, mergeTEps);
    for (const t of uniq) {
      out.push({ x: A.x + t * lx, y: A.y + t * ly });
    }
  }

  return out;
}
