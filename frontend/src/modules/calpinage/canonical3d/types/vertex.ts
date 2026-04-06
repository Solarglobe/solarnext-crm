/**
 * Sommets 3D du maillage / bord toiture.
 */

import type { WorldPosition3D } from "./coordinates";
import type { GeometryProvenance } from "./provenance";
import type { StableEntityId } from "./primitives";

/** Rôle géométrique ou métier du sommet (plusieurs flags possibles via union). */
export type RoofVertexRole =
  | "generic"
  | "eave"
  | "ridge_point"
  | "hip"
  | "valley"
  | "corner"
  | "dormer_attach"
  | "intersection";

export interface RoofVertex3D {
  readonly id: StableEntityId;
  /** Position dans le repère WORLD du modèle (mètres). Voir `types/coordinates.ts`. */
  readonly position: WorldPosition3D;
  readonly role: RoofVertexRole;
  readonly provenance: GeometryProvenance;
}
