/**
 * Géométrie 2D dans le plan (u,v) : point dans polygone, distance point-segment, distance au bord.
 */

const EPS = 1e-12;

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Distance point → segment ouvert [A,B] en 2D. */
export function distancePointToSegment2d(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= EPS) return Math.hypot(px - ax, py - ay);
  const t = clamp01(c1 / c2);
  const qx = ax + t * vx;
  const qy = ay + t * vy;
  return Math.hypot(px - qx, py - qy);
}

/** Ray casting — polygone fermé, sommets dans l’ordre. */
export function pointInPolygon2d(px: number, py: number, poly: readonly { u: number; v: number }[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].u;
    const yi = poly[i].v;
    const xj = poly[j].u;
    const yj = poly[j].v;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + EPS) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Distance minimale d’un point au bord (polyline fermée). */
export function minDistancePointToPolygonBoundary2d(
  px: number,
  py: number,
  poly: readonly { u: number; v: number }[]
): number {
  const n = poly.length;
  if (n < 2) return Infinity;
  let minD = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const d = distancePointToSegment2d(px, py, a.u, a.v, b.u, b.v);
    if (d < minD) minD = d;
  }
  return minD;
}

export interface BoundaryDistanceSampleResult {
  readonly minDistanceM: number;
  /** Max des distances min coin → bord (profondeur du quad le long des coins). */
  readonly maxCornerMinDistanceM: number;
  readonly nearestEdgeIndex: number;
}

/**
 * Distances panneau ↔ bord du pan : min sur tous les échantillons ; max des « clearance » par coin.
 */
export function computePanelToPatchBoundaryMetrics2d(
  panelCornerUvs: readonly { u: number; v: number }[],
  allSampleUvs: readonly { u: number; v: number }[],
  patchBoundary: readonly { u: number; v: number }[]
): BoundaryDistanceSampleResult | null {
  const n = patchBoundary.length;
  if (allSampleUvs.length === 0 || n < 3) return null;

  let globalMin = Infinity;
  let nearestEdge = 0;

  for (let ei = 0; ei < n; ei++) {
    const a = patchBoundary[ei];
    const b = patchBoundary[(ei + 1) % n];
    for (const s of allSampleUvs) {
      const d = distancePointToSegment2d(s.u, s.v, a.u, a.v, b.u, b.v);
      if (d < globalMin) {
        globalMin = d;
        nearestEdge = ei;
      }
    }
  }

  let maxCornerMin = 0;
  for (const c of panelCornerUvs) {
    const d = minDistancePointToPolygonBoundary2d(c.u, c.v, patchBoundary);
    if (d > maxCornerMin) maxCornerMin = d;
  }

  return {
    minDistanceM: globalMin,
    maxCornerMinDistanceM: maxCornerMin,
    nearestEdgeIndex: nearestEdge,
  };
}
