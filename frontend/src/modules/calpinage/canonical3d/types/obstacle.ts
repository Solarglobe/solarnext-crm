/**
 * Obstacle 3D : prisme ou volume simplifié au-dessus d’un footprint.
 *
 * Pour un maillage volumique explicite (sommets, faces, arêtes, AABB), voir `RoofObstacleVolume3D`
 * et `buildRoofVolumes3D` — couche additive, non fusionnée dans `RoofModel3D` tant que non branchée.
 */

import type { LocalFrame3D } from "./frame";
import type { GeometryProvenance } from "./provenance";
import type { QualityBlock } from "./quality";
import type { WorldPosition3D } from "./coordinates";
import type { StableEntityId } from "./primitives";

export type RoofObstacleKind =
  | "chimney"
  | "skylight"
  | "hvac"
  | "parapet"
  | "antenna"
  | "tree_proxy"
  | "drain"
  | "other";

/**
 * Footprint exprimé soit en WORLD (points 3D coplanaires), soit via frame local + 2D.
 * Les deux ne doivent pas être contradictoires si remplis ; la validation vérifiera la cohérence minimale.
 */
export interface RoofObstacle3D {
  readonly id: StableEntityId;
  readonly kind: RoofObstacleKind;
  /** Z de la base dans WORLD (m) — souvent min Z du footprint. */
  readonly baseElevationM: number;
  /** Hauteur verticale au-dessus de la base (m). */
  readonly heightM: number;
  /** Contour 3D coplanaire (WORLD, m). Points du plan de base de l’obstacle. */
  readonly footprintWorld: readonly WorldPosition3D[];
  /** Option : footprint dans un repère plan (ex. plan horizontal projeté). */
  readonly footprintFrame?: LocalFrame3D;
  /** IDs des pans sous-jacents pour keepout / ombrage (optionnel). */
  readonly relatedPlanePatchIds: readonly StableEntityId[];
  readonly provenance: GeometryProvenance;
  readonly quality: QualityBlock;
}
