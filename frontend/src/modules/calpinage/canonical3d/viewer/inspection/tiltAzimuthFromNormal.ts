/**
 * Lecture géométrique affichable quand `tiltDeg` / `azimuthDeg` absents du patch (normale WORLD, Z up).
 * Ne remplace pas une vérité métier — uniquement aide visuelle inspection.
 */

import type { Vector3 } from "../../types/primitives";

/** Pente du plan vs horizontal (0° = horizontal). */
export function tiltDegFromOutwardNormalWorld(n: Vector3): number | null {
  if (![n.x, n.y, n.z].every((v) => Number.isFinite(v))) return null;
  const hz = Math.hypot(n.x, n.y);
  const nz = Math.abs(n.z);
  if (hz < 1e-12 && nz < 1e-12) return null;
  return (Math.atan2(hz, nz) * 180) / Math.PI;
}

/**
 * Azimut convention approximative : 0° = Nord (+Y), 90° = Est (+X), sens horaire vue du ciel.
 */
export function azimuthDegFromOutwardNormalWorld(n: Vector3): number | null {
  if (![n.x, n.y, n.z].every((v) => Number.isFinite(v))) return null;
  const x = -n.x;
  const y = -n.y;
  const h = Math.hypot(x, y);
  if (h < 1e-9) return null;
  let deg = (Math.atan2(x, y) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}
