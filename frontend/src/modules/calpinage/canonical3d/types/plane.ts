/**
 * Plan affine 3D : demi-espace et équation.
 *
 * CONTRAT PlaneEquation :
 * - n = (a, b, c) est la normale **unitaire** pointant vers l’extérieur du volume sous toiture
 *   (côté « ciel ») pour une face orientée donnée. Signe de d aligné avec cette convention.
 * - Équation implicite : a*x + b*y + c*z + d = 0 pour tout point (x,y,z) du plan.
 * - Les coordonnées sont dans le repère WORLD du RoofModel3D.
 */

import type { Vector3 } from "./primitives";

/** Normale unitaire (a,b,c) et terme d tel que ax+by+cz+d = 0. */
export interface PlaneEquation {
  readonly normal: Vector3;
  readonly d: number;
}

/** Demi-espace défini par un plan orienté : quel côté est « intérieur » / « extérieur » selon le contexte métier. */
export type HalfSpaceSide = "positive_normal" | "negative_normal";
