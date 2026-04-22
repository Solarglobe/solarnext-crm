/**
 * Niveau 2 — tolérances image (px) adaptées à `metersPerPixel` pour le collage multi-pans.
 */

import { LEGACY_SHARED_CORNER_CLUSTER_TOL_PX } from "./unifyLegacyPanSharedCornersZ";

/** Cible ~0,32 m de « colle » géométrique entre sommets voisins (convertie en px). */
const GLUE_WORLD_M = 0.32;

/**
 * Tolérance cluster coins partagés (px) : min historique 6, plafond 22, sinon dérivée du mpp.
 */
export function legacySharedCornerClusterTolPx(metersPerPixel: number): number {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return LEGACY_SHARED_CORNER_CLUSTER_TOL_PX;
  }
  const fromMpp = Math.round(GLUE_WORLD_M / metersPerPixel);
  return Math.min(22, Math.max(LEGACY_SHARED_CORNER_CLUSTER_TOL_PX, fromMpp));
}

/**
 * Longueur minimale d’arête 2D (px) pour accepter un match inter-pans — liée à la tolérance cluster.
 */
export function legacyMinSharedEdgeLenPx(cornerClusterTolPx: number): number {
  if (!Number.isFinite(cornerClusterTolPx) || cornerClusterTolPx <= 0) return 3;
  return Math.max(2, Math.min(8, Math.round(cornerClusterTolPx * 0.35)));
}
