/**
 * Algèbre vectorielle 3D pure (pas d’allocation mutable partagée — retourne nouveaux objets).
 */

import type { PlaneEquation } from "../types/plane";
import type { Vector3 } from "../types/primitives";

const EPS = 1e-9;

export function vec3(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

export function isFiniteVec3(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function add3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(a: Vector3, s: number): Vector3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot3(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length3(a: Vector3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize3(a: Vector3): Vector3 | null {
  if (!isFiniteVec3(a)) return null;
  const len = length3(a);
  if (!Number.isFinite(len) || len < EPS) return null;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function nearlyEqual3(a: Vector3, b: Vector3, eps = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;
}

export function distance3(a: Vector3, b: Vector3): number {
  return length3(sub3(a, b));
}

/**
 * Distance signée du point au plan défini par `equation` (normale unitaire).
 * Valeur : n·p + d (0 si p est dans le plan).
 */
export function signedDistanceToPlane(point: Vector3, equation: PlaneEquation): number {
  return dot3(equation.normal, point) + equation.d;
}

/** Vecteur direction ; souvent attendu unitaire pour `RoofEdge3D.directionWorld`. */
export function isApproxUnitDirection3(v: Vector3, eps = 1e-4): boolean {
  const len = length3(v);
  return Math.abs(len - 1) < eps;
}

/**
 * Vérifie si (xAxis, yAxis, zAxis) forme une base main-droite orthonormée approximative.
 */
export function isRightHandedOrthonormalFrame(
  xAxis: Vector3,
  yAxis: Vector3,
  zAxis: Vector3,
  eps = 1e-5
): boolean {
  const cx = cross3(xAxis, yAxis);
  if (!nearlyEqual3(cx, zAxis, eps)) return false;
  const lx = length3(xAxis);
  const ly = length3(yAxis);
  const lz = length3(zAxis);
  return Math.abs(lx - 1) < eps && Math.abs(ly - 1) < eps && Math.abs(lz - 1) < eps;
}
