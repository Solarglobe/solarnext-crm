/**
 * Primitives numériques du module canonique 3D.
 *
 * CONTRAT REPÈRE (WORLD) :
 * - Tous les Vector3 exprimés en mètres sauf mention explicite d’un autre repère
 *   dans le champ parent (ex. LocalFrame3D définit son propre repère local).
 * - Convention main droite : X, Y, Z orthogonaux et normés dans les frames déclarés.
 *
 * Ce module est volontairement indépendant du legacy calpinage (image px, etc.).
 */

/** Vecteur ou point 3D en unités SI (mètres) dans le repère monde du modèle. */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Identifiant stable d’entité (sommet, arête, pan…).
 * Contrat : non vide, immutable une fois publié ; préférer UUID v4 ou slug opaque unique.
 * Le typage reste `string` pour sérialisation JSON simple ; la stabilité est contractuelle.
 */
export type StableEntityId = string;

/**
 * Mesure de surface : aire métrique (m²) et option projetée sur le plan horizontal WORLD.
 *
 * - `areaM2` : aire sur la surface 3D du pan (plan incliné).
 * - `projectedHorizontalAreaM2` : projection **orthogonale** sur le plan perpendiculaire à
 *   `RoofModelMetadata.referenceFrame.upAxis` (pas la projection sur le plan du pan).
 */
export interface SurfaceMeasures {
  /** Aire intrinsèque de la surface 3D (pan développé / mesure sur le plan incliné). */
  readonly areaM2: number;
  /** Aire de la projection orthogonale sur le plan horizontal WORLD (voir coordinates.ts). */
  readonly projectedHorizontalAreaM2?: number;
}
