/**
 * Repères locaux attachés à une face de toiture ou à un outil d’analyse.
 *
 * **Espace** : tous les champs sont exprimés en **coordonnées WORLD** (vecteurs libres pour les axes).
 * Voir aussi `types/coordinates.ts` (WORLD vs UV pan).
 *
 * CONTRAT LocalFrame3D (main droite) :
 * - origin : point WORLD ancré sur le plan (souvent coin ou centroïde).
 * - xAxis, yAxis : vecteurs unitaires **dans le plan** de la face (tangents).
 * - zAxis : normal unitaire — en général alignée avec la normale **extérieure** du pan.
 * - xAxis × yAxis = zAxis (à tolérance numérique près).
 *
 * Passage local → world : `origin + u*xAxis + v*yAxis + w*zAxis` ; sur le plan du pan, w = 0.
 */

import type { Vector3 } from "./primitives";

/** Rôle du repère pour la traçabilité (pas le nom du repère mathématique monde). */
export type LocalFrameRole =
  | "roof_face"
  | "obstacle_footprint"
  | "analysis"
  | "export"
  /** Surface module PV (repère tangent au quad du panneau). */
  | "pv_panel_surface";

export interface LocalFrame3D {
  readonly role: LocalFrameRole;
  readonly origin: Vector3;
  readonly xAxis: Vector3;
  readonly yAxis: Vector3;
  readonly zAxis: Vector3;
  /**
   * Optionnel : matrice 4×4 colonne-major world = M * localHomogeneous.
   * Si absent, les consommateurs dérivent la pose depuis origin + axes.
   */
  readonly worldFromLocalColumnMajor4x4?: readonly number[];
}
