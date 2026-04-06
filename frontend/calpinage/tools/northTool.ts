/**
 * Outil Nord : orientation de la toiture dans le référentiel IMAGE.
 * - Mode auto-google : angle déduit du bearing Google à la capture (northAngleDeg = -bearingDeg).
 * - Mode manuel : réglage par l'utilisateur (slider ±180° ou drag).
 * Référence unique pour azimuts : azimutReelDeg = panAngleImageDeg + north.angleDeg.
 */

import { applyCanonical3DWorldContractToRoof } from "../../src/modules/calpinage/runtime/canonical3DWorldContract";
import type { NorthState } from "../state/roofState";

export type RoofStateWithNorth = {
  roof: { north: null | NorthState };
};

/**
 * Retourne l'angle Nord en degrés (référentiel image, 0 = haut) ou null si non défini.
 */
export function getNorthAngleDeg(roofState: RoofStateWithNorth): number | null {
  const north = roofState.roof?.north;
  if (!north) return null;
  return north.angleDeg;
}

/**
 * Définit le Nord en mode auto à partir du bearing Google (à appeler à la capture).
 * northAngleDeg = -bearingDeg (carte tournée de +X° ⇒ Nord visuel tourné de -X°).
 */
export function setNorthFromBearing(
  roofState: RoofStateWithNorth,
  bearingDeg: number
): void {
  const roof = roofState.roof ?? { north: null };
  roofState.roof = roof;
  roof.north = {
    mode: "auto-google",
    angleDeg: -bearingDeg,
  };
  applyCanonical3DWorldContractToRoof(roofState as unknown);
}

/**
 * Passe en mode manuel et fixe l'angle Nord (override du mode auto).
 */
export function setNorthManual(
  roofState: RoofStateWithNorth,
  angleDeg: number
): void {
  const roof = roofState.roof ?? { north: null };
  roofState.roof = roof;
  roof.north = {
    mode: "manual",
    angleDeg,
  };
  applyCanonical3DWorldContractToRoof(roofState as unknown);
}

/**
 * Formule de référence pour l'azimut réel (pans, panneaux, export SmartPitch, PDF/JSON).
 * azimutReelDeg = panAngleImageDeg + roofState.north.angleDeg
 */
export function getAzimutReelDeg(
  panAngleImageDeg: number,
  roofState: RoofStateWithNorth
): number | null {
  const north = roofState.roof?.north;
  if (!north) return null;
  return panAngleImageDeg + north.angleDeg;
}

/**
 * Normalise un angle en degrés dans [0, 360[ (pour affichage uniquement).
 */
export function normalizeAngleDegForDisplay(angleDeg: number): number {
  let a = angleDeg % 360;
  if (a < 0) a += 360;
  return a;
}
