/**
 * Outil Calibration (étape 5.2) et outil Mesure.
 * - Calibration : clic A, clic B, saisie distance réelle → calcul metersPerPixel, stockage dans roofState.
 * - Mesure : clic A, clic B → affichage distance en mètres (vérification cohérence).
 */

import { applyCanonical3DWorldContractToRoof } from "../../src/modules/calpinage/runtime/canonical3DWorldContract";

export type PointImage = { x: number; y: number };

export type RoofStateLike = {
  scale: null | { metersPerPixel: number };
  calibration: null | { A: PointImage; B: PointImage; meters: number };
};

/** Distance pixel minimale pour accepter une calibration (évite division par trop petit). */
export const MIN_PIXEL_DISTANCE = 5;

/**
 * Distance en pixels entre deux points (coordonnées image).
 */
export function getPixelDistance(A: PointImage, B: PointImage): number {
  return Math.hypot(B.x - A.x, B.y - A.y);
}

/**
 * Valide et applique la calibration : calcule metersPerPixel et stocke scale + calibration.
 * Refuse si A ou B manquant, meters ≤ 0, ou distance pixel trop faible.
 */
export function validateAndApplyCalibration(
  roofState: RoofStateLike,
  A: PointImage,
  B: PointImage,
  meters: number
): { ok: true } | { ok: false; error: string } {
  if (meters <= 0) {
    return { ok: false, error: "La distance réelle doit être strictement positive (m)." };
  }
  const pixelDistance = getPixelDistance(A, B);
  if (pixelDistance < MIN_PIXEL_DISTANCE) {
    return { ok: false, error: "Les deux points sont trop proches. Choisissez une plus grande distance sur l'image." };
  }
  const metersPerPixel = meters / pixelDistance;
  (roofState as RoofStateLike & { scale: unknown }).scale = { metersPerPixel };
  (roofState as RoofStateLike & { calibration: unknown }).calibration = { A: { ...A }, B: { ...B }, meters };
  applyCanonical3DWorldContractToRoof(roofState);
  return { ok: true };
}

/**
 * Calcule la distance en mètres entre deux points image lorsque l'échelle est définie.
 * Retourne null si pas d'échelle.
 */
export function getMetersFromPixels(
  roofState: RoofStateLike,
  A: PointImage,
  B: PointImage
): number | null {
  if (!roofState.scale) return null;
  const pixelDistance = getPixelDistance(A, B);
  return pixelDistance * roofState.scale.metersPerPixel;
}
