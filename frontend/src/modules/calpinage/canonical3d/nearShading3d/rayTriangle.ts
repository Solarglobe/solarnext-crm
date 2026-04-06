/**
 * Intersection rayon ↔ triangle (Möller–Trumbore), côtés doubles pour maillage fermé.
 */

import type { Vector3 } from "../types/primitives";
import { cross3, dot3, sub3 } from "../utils/math3";

const EPS = 1e-12;

/**
 * @returns paramètre t le long du rayon `origin + t * dir` si intersection dans le demi-espace t > tMinRay, sinon null.
 */
export function rayTriangleIntersectMollerTrumbore(
  origin: Vector3,
  dir: Vector3,
  v0: Vector3,
  v1: Vector3,
  v2: Vector3,
  tMinRay: number
): number | null {
  const edge1 = sub3(v1, v0);
  const edge2 = sub3(v2, v0);
  const pvec = cross3(dir, edge2);
  const det = dot3(edge1, pvec);
  if (Math.abs(det) < EPS) return null;
  const invDet = 1 / det;
  const tvec = sub3(origin, v0);
  const u = dot3(tvec, pvec) * invDet;
  if (u < 0 || u > 1) return null;
  const qvec = cross3(tvec, edge1);
  const v = dot3(dir, qvec) * invDet;
  if (v < 0 || u + v > 1) return null;
  const t = dot3(edge2, qvec) * invDet;
  if (t < tMinRay) return null;
  return t;
}
