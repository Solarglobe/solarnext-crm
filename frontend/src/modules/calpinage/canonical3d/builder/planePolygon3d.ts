/**
 * Plans et polygones 3D purs : normale (Newell), aires, équation, cadre local.
 * Aucune dépendance au legacy.
 */

import type { PlaneEquation } from "../types/plane";
import type { LocalFrame3D } from "../types/frame";
import type { Vector3 } from "../types/primitives";
import { cross3, dot3, length3, normalize3, scale3, sub3, vec3 } from "../utils/math3";

const EPS = 1e-10;

/** Normale non normalisée par la méthode de Newell (polygone 3D plan quelconque). */
export function newellNormalUnnormalized(pts: readonly Vector3[]): Vector3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return { x: nx, y: ny, z: nz };
}

export function centroid3(pts: readonly Vector3[]): Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const k = pts.length;
  return { x: x / k, y: y / k, z: z / k };
}

/**
 * RMS des distances signées au plan (n unitaire, d = -n·c avec c centroïde).
 */
export function planeFitResidualRms(pts: readonly Vector3[], normal: Vector3, c: Vector3): number {
  const d = -dot3(normal, c);
  let s = 0;
  for (const p of pts) {
    const sd = dot3(normal, p) + d;
    s += sd * sd;
  }
  return Math.sqrt(s / pts.length);
}

/**
 * Normale extérieure « vers le ciel » : parmi ±n, choisit celle avec dot(n, upWorld) ≥ 0.
 */
export function orientExteriorNormalTowardSky(n: Vector3, upWorld: Vector3): Vector3 {
  const nu = normalize3(n);
  if (!nu) return { x: 0, y: 0, z: 1 };
  const uu = normalize3(upWorld);
  if (!uu) return nu;
  if (dot3(nu, uu) < 0) return { x: -nu.x, y: -nu.y, z: -nu.z };
  return nu;
}

export function planeEquationFromUnitNormalAndPoint(normal: Vector3, pointOnPlane: Vector3): PlaneEquation {
  const d = -dot3(normal, pointOnPlane);
  return { normal: { ...normal }, d };
}

/**
 * Aire du polygone 3D par somme des aires de triangles (O, pi, pj) — O = premier sommet.
 */
export function polygonArea3dIntrinsic(pts: readonly Vector3[]): number {
  if (pts.length < 3) return 0;
  const o = pts[0];
  let a = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ab = sub3(pts[i], o);
    const ac = sub3(pts[i + 1], o);
    a += length3(cross3(ab, ac)) * 0.5;
  }
  return a;
}

/** Aire de la projection orthogonale sur le plan z=0 (WORLD Z vertical). */
export function polygonProjectedHorizontalAreaXY(pts: readonly Vector3[]): number {
  if (pts.length < 3) return 0;
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) * 0.5;
}

/** Axe X tangent dans le plan : première arête du bord normalisée. */
export function tangentXInPlane(firstEdgeFromA: Vector3, unitNormal: Vector3): Vector3 | null {
  const t = sub3(firstEdgeFromA, scale3(unitNormal, dot3(firstEdgeFromA, unitNormal)));
  return normalize3(t);
}

export function buildLocalFrameRoofFace(
  origin: Vector3,
  unitNormal: Vector3,
  firstBoundaryVector: Vector3
): LocalFrame3D {
  const zAxis = { ...unitNormal };
  const xRaw = tangentXInPlane(firstBoundaryVector, unitNormal);
  const xAxis = xRaw ?? vec3(1, 0, 0);
  const yAxis = normalize3(cross3(zAxis, xAxis));
  if (!yAxis) {
    return {
      role: "roof_face",
      origin: { ...origin },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...zAxis },
    };
  }
  const xOrtho = normalize3(cross3(yAxis, zAxis)) ?? xAxis;
  return {
    role: "roof_face",
    origin: { ...origin },
    xAxis: xOrtho,
    yAxis,
    zAxis,
  };
}

/** (u,v) du point dans le repère (origin, xAxis, yAxis). */
export function projectPointToPlaneUv(
  p: Vector3,
  origin: Vector3,
  xAxis: Vector3,
  yAxis: Vector3
): { u: number; v: number } {
  const r = sub3(p, origin);
  return { u: dot3(r, xAxis), v: dot3(r, yAxis) };
}

/**
 * Pente du plan vs horizontal : angle entre normale et verticale projeté en angle surface/horizontal.
 * 0° = toit plat (normale verticale).
 */
export function tiltDegFromNormalAndUp(n: Vector3, up: Vector3): number {
  const nu = normalize3(n);
  const uu = normalize3(up);
  if (!nu || !uu) return 0;
  const along = Math.abs(dot3(nu, uu));
  const horiz = Math.sqrt(Math.max(0, 1 - along * along));
  return (Math.atan2(horiz, along) * 180) / Math.PI;
}

/** Azimut 0=Nord, 90=Est (ENU) : atan2(East, North) sur la composante horizontale de n. */
export function azimuthDegEnuHorizontalNormal(n: Vector3): number {
  const d = Math.hypot(n.x, n.y);
  if (d < EPS) return 0;
  return ((Math.atan2(n.x, n.y) * 180) / Math.PI + 360) % 360;
}
