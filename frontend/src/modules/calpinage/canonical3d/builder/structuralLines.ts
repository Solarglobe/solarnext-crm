/**
 * Correspondance lignes structurantes 2D (image → WORLD) ↔ arêtes 3D fusionnées.
 * Utilisé pour produire des `RoofRidge3D` traçables et annoter les arêtes (sémantique / ridgeLineId).
 */

import type { RoofEdge3D } from "../types/edge";
import type { Vector3 } from "../types/primitives";

/** Tolérance distance point → segment (m) en plan XY monde. */
export const STRUCTURAL_LINE_MATCH_TOL_M = 0.1;

/** Tolérance colinéarité (sin/cross normalisé). */
const CROSS_TOL = 0.035;

export function projectScalarAlongSegmentXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return 0;
  return ((px - ax) * dx + (py - ay) * dy) / len2;
}

export function distPointToSegment2DXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  let t = projectScalarAlongSegmentXY(px, py, ax, ay, bx, by);
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * (bx - ax);
  const qy = ay + t * (by - ay);
  return Math.hypot(px - qx, py - qy);
}

/**
 * Vrai si le segment arête (pa,pb) en XY est aligné sur [sa,sb] avec distances bornées.
 */
export function edgeLiesOnStructuralSegmentXY(
  pa: Vector3,
  pb: Vector3,
  sa: Vector3,
  sb: Vector3,
  tolM: number
): boolean {
  const ax = sa.x;
  const ay = sa.y;
  const bx = sb.x;
  const by = sb.y;
  const d1 = distPointToSegment2DXY(pa.x, pa.y, ax, ay, bx, by);
  const d2 = distPointToSegment2DXY(pb.x, pb.y, ax, ay, bx, by);
  if (d1 > tolM || d2 > tolM) return false;

  const ex = pb.x - pa.x;
  const ey = pb.y - pa.y;
  const rx = bx - ax;
  const ry = by - ay;
  const cross = ex * ry - ey * rx;
  const elen = Math.hypot(ex, ey);
  const rlen = Math.hypot(rx, ry);
  if (elen < 1e-9 || rlen < 1e-9) return false;
  return Math.abs(cross) / (elen * rlen) < CROSS_TOL;
}

/**
 * Paramètre moyen le long du segment structurant [sa,sb] pour ordonner les arêtes.
 */
export function meanProjectionTOnSegment(pa: Vector3, pb: Vector3, sa: Vector3, sb: Vector3): number {
  const ta = projectScalarAlongSegmentXY(pa.x, pa.y, sa.x, sa.y, sb.x, sb.y);
  const tb = projectScalarAlongSegmentXY(pb.x, pb.y, sa.x, sa.y, sb.x, sb.y);
  return (ta + tb) * 0.5;
}

/**
 * Collecte les IDs d’arêtes dont la géométrie XY coïncide avec le segment [sa,sb], triées le long du segment.
 */
export function collectEdgeIdsAlongStructuralSegmentXY(
  edges: readonly RoofEdge3D[],
  vertexPositions: ReadonlyMap<string, Vector3>,
  sa: Vector3,
  sb: Vector3,
  tolM: number = STRUCTURAL_LINE_MATCH_TOL_M
): readonly string[] {
  const matched: { id: string; t: number }[] = [];
  for (const e of edges) {
    const pa = vertexPositions.get(e.vertexAId);
    const pb = vertexPositions.get(e.vertexBId);
    if (!pa || !pb) continue;
    if (!edgeLiesOnStructuralSegmentXY(pa, pb, sa, sb, tolM)) continue;
    const t = meanProjectionTOnSegment(pa, pb, sa, sb);
    matched.push({ id: e.id, t });
  }
  matched.sort((a, b) => a.t - b.t);
  return matched.map((m) => m.id);
}
