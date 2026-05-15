/**
 * Sommet central unique du chien assis : intersection des arêtiers (plans infinis en 2D image).
 * Aligné sur la géométrie legacy `intersectLines` (calpinage.module.js).
 */

export interface RoofExtensionApexPersisted {
  /** Identité stable pour shading/export — même vertex que fins des hips + bout faîtage au sommet */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Hauteur métrique relative au pan support (optionnel ; pilotée souvent par ridgeHeightRelM). */
  readonly h?: number;
}

export function intersectInfiniteLines2D(
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
): { readonly x: number; readonly y: number } | null {
  const a1 = ay2 - ay1;
  const b1 = ax1 - ax2;
  const c1 = a1 * ax1 + b1 * ay1;
  const a2 = by2 - by1;
  const b2 = bx1 - bx2;
  const c2 = a2 * bx1 + b2 * by1;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (b2 * c1 - b1 * c2) / det,
    y: (a1 * c2 - a2 * c1) / det,
  };
}

/** Tolérance pixels image : coincide après sync legacy ; tolère léger jitter float JSON */
export const ROOF_EXTENSION_APEX_PIXEL_MERGE_TOL = 0.5;

export function pointsCoincidePx(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tolPx = ROOF_EXTENSION_APEX_PIXEL_MERGE_TOL,
): boolean {
  return Math.hypot(ax - bx, ay - by) <= tolPx;
}

export function stableApexId(extensionId: string): string {
  const base = extensionId.length > 0 ? extensionId : "roof-extension";
  return `${base}:apex`;
}
