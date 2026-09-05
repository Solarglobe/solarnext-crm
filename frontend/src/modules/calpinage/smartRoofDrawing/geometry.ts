import type { SmartRoofNode } from "./types";

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface ProjectionOnSegment {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly distance: number;
}

export const DEFAULT_MODEL_TOLERANCE_PX = 0.001;
export const DEFAULT_SCREEN_SNAP_TOLERANCE_PX = 10;

export function sqr(v: number): number {
  return v * v;
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function dot(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y);
}

export function projectPointOnSegment(p: Point2D, a: Point2D, b: Point2D): ProjectionOnSegment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= Number.EPSILON) {
    return { x: a.x, y: a.y, t: 0, distance: distance(p, a) };
  }
  const rawT = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const t = Math.max(0, Math.min(1, rawT));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return { x, y, t, distance: distance(p, { x, y }) };
}

export function pointOnSegment(p: Point2D, a: Point2D, b: Point2D, tolerance: number): boolean {
  const projection = projectPointOnSegment(p, a, b);
  return projection.distance <= tolerance && projection.t >= -tolerance && projection.t <= 1 + tolerance;
}

export function sameConnectivityLevel(a: SmartRoofNode, b: SmartRoofNode): boolean {
  return (a.groupId ?? null) === (b.groupId ?? null) && (a.levelId ?? null) === (b.levelId ?? null);
}

export function signedPolygonArea(points: readonly Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function polygonArea(points: readonly Point2D[]): number {
  return Math.abs(signedPolygonArea(points));
}

export function canonicalPointKey(p: Point2D, precision = 6): string {
  return `${p.x.toFixed(precision)},${p.y.toFixed(precision)}`;
}

export function canonicalPolygonKey(points: readonly Point2D[], precision = 6): string {
  if (points.length === 0) return "";
  const keys = points.map((p) => canonicalPointKey(p, precision));
  const variants: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    variants.push([...keys.slice(i), ...keys.slice(0, i)].join("|"));
  }
  const reversed = [...keys].reverse();
  for (let i = 0; i < reversed.length; i++) {
    variants.push([...reversed.slice(i), ...reversed.slice(0, i)].join("|"));
  }
  return variants.sort()[0] ?? "";
}

export function lineIntersectionParameter(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
  tolerance: number,
): { readonly t: number; readonly u: number; readonly point: Point2D } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) <= tolerance) return null;
  const qmp = { x: c.x - a.x, y: c.y - a.y };
  const t = (qmp.x * s.y - qmp.y * s.x) / den;
  const u = (qmp.x * r.y - qmp.y * r.x) / den;
  return {
    t,
    u,
    point: { x: a.x + t * r.x, y: a.y + t * r.y },
  };
}

export function areColinearOverlapping(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
  tolerance: number,
): boolean {
  if (Math.abs(cross(a, b, c)) > tolerance || Math.abs(cross(a, b, d)) > tolerance) return false;
  const useX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const a0 = useX ? a.x : a.y;
  const a1 = useX ? b.x : b.y;
  const c0 = useX ? c.x : c.y;
  const c1 = useX ? d.x : d.y;
  const minA = Math.min(a0, a1);
  const maxA = Math.max(a0, a1);
  const minC = Math.min(c0, c1);
  const maxC = Math.max(c0, c1);
  return Math.max(minA, minC) < Math.min(maxA, maxC) - tolerance;
}
