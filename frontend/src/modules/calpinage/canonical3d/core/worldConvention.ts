/**
 * Convention monde 3D officielle SolarNext — point d’ancrage unique pour le calpinage canonique.
 *
 * Contrat typé verrouillé : `canonical3d/world/` (`CanonicalWorldConfig`, `unifiedWorldFrame`, `imagePointToWorld`).
 * Documentation : docs/architecture/3d-world-convention.md
 * Repères détaillés : types/coordinates.ts, types/model.ts (WorldReferenceFrame).
 *
 * Les helpers délèguent à `worldMapping` / `math3` : zéro duplication de formules.
 */

import { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "../builder/worldMapping";
import type { Vector3 } from "../types/primitives";
import { normalize3 } from "../utils/math3";

/** Métadonnées stables de la convention (audit / UI debug — pas de logique implicite cachée). */
export const WORLD_CONVENTION = {
  /** Schéma documentaire ; le détail mathématique est dans `referenceFrame.upAxis` du modèle. */
  canonicalAxisSemantics: {
    /** Plan horizontal monde = orthogonal à upAxis ; convention nommée ENU_Z_UP dans model.ts */
    horizontalX: "Est (après rotation nord)",
    horizontalY: "Nord (après rotation nord)",
    vertical: "Z positif = upAxis (typiquement Z up)",
  },
  units: {
    imageSpace: "px",
    worldSpace: "m",
    viewerOfficial: "m (identique au world — pas de rescale métier)",
    panUvPlane: "m dans repère tangent pan",
    angleNorth: "deg",
  },
  /** Origine du mapping image→horizontal monde canonique : coin pixel (0,0) — voir worldMapping.ts */
  imageToWorldHorizontalOrigin: "image_top_left_px_0_0",
  /** Implémentation de référence */
  mappingImplementation: "canonical3d/builder/worldMapping.ts → imagePxToWorldHorizontalM",
  /** Legacy preview : houseModelV2 + phase3Viewer (Y-up Three.js, originPx) — ne pas confondre avec canonique */
  legacyApproximation: "houseModelV2.ts + calpinage/phase3/phase3Viewer.js",
} as const;

export type WorldHorizontalM = { readonly x: number; readonly y: number };
export type WorldPoint3DM = Vector3;
export type ImagePointPx = { readonly xPx: number; readonly yPx: number };

/**
 * Point image → projection sur le plan horizontal monde (m), avant Z.
 * @see imagePxToWorldHorizontalM
 */
export function imagePointToWorldHorizontal(
  p: ImagePointPx,
  metersPerPixel: number,
  northAngleDeg: number
): WorldHorizontalM {
  return imagePxToWorldHorizontalM(p.xPx, p.yPx, metersPerPixel, northAngleDeg);
}

/**
 * Inverse de `imagePxToWorldHorizontalM` : plan horizontal monde (x,y) → pixels image.
 * Utile tests aller-retour ; même hypothèses que worldMapping (rotation autour Z après base scale).
 */
export function worldHorizontalToImagePoint(
  xM: number,
  yM: number,
  metersPerPixel: number,
  northAngleDeg: number
): ImagePointPx {
  return worldHorizontalMToImagePx(xM, yM, metersPerPixel, northAngleDeg);
}

/**
 * Point 3D monde → entrée viewer officiel (Three.js) : identité pour le pipeline SolarScene3D.
 * Ne pas utiliser pour phase3Viewer legacy (repère différent).
 */
export function worldPointToViewer(p: WorldPoint3DM): WorldPoint3DM {
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * Normalise un vecteur monde (direction). Retourne null si nul ou non fini.
 */
export function normalizeWorldVector(v: Vector3): Vector3 | null {
  return normalize3(v);
}

/**
 * Échelles utiles pour documenter les conversions (pas de magie).
 * - `metersPerPixel` : image → monde horizontal
 * - `worldMetersPerUnit` : toujours 1 pour le world canonique (1 unité = 1 m)
 */
export function getWorldUnitScale(metersPerPixel: number): {
  readonly worldMetersPerUnit: 1;
  readonly metersPerImagePixel: number;
} {
  const mpp = Number.isFinite(metersPerPixel) ? metersPerPixel : NaN;
  return { worldMetersPerUnit: 1, metersPerImagePixel: mpp };
}
