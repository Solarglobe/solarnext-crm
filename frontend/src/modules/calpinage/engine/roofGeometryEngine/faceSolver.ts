/**
 * Phase 3 — Solveur géométrique principal d\'un pan de toiture.
 *
 * Transforme un RoofFace (polygone 2D image + heights optionnels) +
 * WorldTransform + HeightResolver en RoofFaceDerived3D (coins 3D monde,
 * normale, pente, azimut, axes de pente et de faîtage).
 *
 * Chaîne de calcul :
 *   polygonPx + Z → cornersWorld (imagePxToWorldHorizontalM)
 *   cornersWorld → normalWorld   (Newell, via normalCalc)
 *   normalWorld  → tilt + azimut + axes (via tiltAzimuthCalc)
 *   cornersWorld → projectedAreaM2 (shoelace XY)
 *
 * Aucune référence à window.* ni au runtime calpinage.
 * Pour la résolution Z runtime, injecter RuntimeHeightResolver (heightInterpolator.ts).
 */

import type { RoofFace, RoofFaceDerived3D, Vec3, WorldCorner3D } from "../interfaces/PanContext";
import type { WorldTransform } from "../interfaces/WorldTransform";
import type { HeightResolver } from "../interfaces/HeightResolver";
import { imagePxToWorldHorizontalM } from "../../canonical3d/builder/worldMapping";
import { polygonProjectedHorizontalAreaXY } from "../../canonical3d/builder/planePolygon3d";
import { computeRoofFaceNormal } from "./normalCalc";
import { computeTiltAzimuth } from "./tiltAzimuthCalc";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes dégénérées
// ─────────────────────────────────────────────────────────────────────────────

const FLAT_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };
const FLAT_SLOPE_AXIS: Vec3 = { x: 0, y: 1, z: 0 };  // Nord
const FLAT_PERP_AXIS: Vec3 = { x: 1, y: 0, z: 0 };   // Est

/** RoofFaceDerived3D de repli : toit plat à Z=0, azimut Sud par convention. */
function degenerateResult(cornersWorld: readonly WorldCorner3D[]): RoofFaceDerived3D {
  return {
    tiltDeg: 0,
    azimuthDeg: 180,
    normalWorld: FLAT_NORMAL,
    cornersWorld,
    slopeAxisWorld: FLAT_SLOPE_AXIS,
    perpAxisWorld: FLAT_PERP_AXIS,
    projectedAreaM2: polygonProjectedHorizontalAreaXY(cornersWorld),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// solveFace — point d\'entrée principal Phase 3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcule la géométrie 3D complète d\'un pan de toiture depuis ses données 2D source.
 *
 * Priorisation Z pour chaque sommet :
 *   1. vertex.heightM explicite (saisie utilisateur en Phase 2)
 *   2. resolver.getHeightAtImagePoint(xPx, yPx, face.id)
 *      → RuntimeHeightResolver : délègue à window.getHeightAtXY (fitPlane/ridges/traits)
 *      → ConstraintHeightResolver : ridges + traits depuis validatedRoofData
 *      → FallbackHeightResolver : hauteur constante (tests)
 *
 * @param face      — données source 2D (polygonPx, roofType, tiltDegExplicit optionnel)
 * @param transform — mètres/pixel + angleDeg nord (depuis CALPINAGE_STATE.roof)
 * @param resolver  — résolveur de hauteurs Z, injecté par l\'appelant
 * @returns RoofFaceDerived3D — données 3D calculées, non persistées
 */
export function solveFace(
  face: RoofFace,
  transform: WorldTransform,
  resolver: HeightResolver,
): RoofFaceDerived3D {
  const { metersPerPixel, northAngleDeg } = transform;

  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return degenerateResult([]);
  }

  // ── 1. Résolution Z + projection px → WORLD ENU ────────────────────────────
  const cornersWorld: WorldCorner3D[] = [];

  for (const vertex of face.polygonPx) {
    const { xPx, yPx } = vertex;

    // Priorité 1 : hauteur explicite sur le sommet (saisie Phase 2)
    let z: number;
    if (typeof vertex.heightM === "number" && Number.isFinite(vertex.heightM)) {
      z = vertex.heightM;
    } else {
      // Priorité 2 : resolver (runtime / contraintes / fallback)
      z = resolver.getHeightAtImagePoint(xPx, yPx, face.id).heightM;
    }

    const { x, y } = imagePxToWorldHorizontalM(xPx, yPx, metersPerPixel, northAngleDeg);
    cornersWorld.push({ x, y, z });
  }

  if (cornersWorld.length < 3) {
    return degenerateResult(cornersWorld);
  }

  // ── 2. Normale Newell ────────────────────────────────────────────────────────
  const normalWorld: Vec3 = computeRoofFaceNormal(cornersWorld) ?? FLAT_NORMAL;

  // ── 3. Pente + azimut + axes ────────────────────────────────────────────────
  const { tiltDeg, azimuthDeg, slopeAxisWorld, perpAxisWorld } =
    computeTiltAzimuth(normalWorld);

  // ── 4. Aire projetée horizontale ─────────────────────────────────────────────
  const projectedAreaM2 = polygonProjectedHorizontalAreaXY(cornersWorld);

  return {
    tiltDeg,
    azimuthDeg,
    normalWorld,
    cornersWorld,
    slopeAxisWorld,
    perpAxisWorld,
    projectedAreaM2,
  };
}
