/**
 * Ancrage d’un volume volumique sur la toiture reconstruite (pans planaires).
 */

import type { StableEntityId } from "./primitives";

/**
 * Qualité de l’ancrage : pan trouvé, repli monde, ambiguïté multi-pans, etc.
 */
export type VolumeRoofAnchorKind =
  | "anchored_single_plane"
  | "anchored_projection_only"
  | "fallback_world_vertical"
  | "no_plane_context"
  | "primary_plane_not_found";

/**
 * Indication métier sur la relation volume / toiture (pas un solveur d’intersection complet).
 */
export type VolumeRoofRelationHint =
  | "seated_on_plane"
  | "extrusion_world_vertical_only"
  | "extrusion_along_pan_normal"
  | "hybrid_vertical_base_on_sloped_plane"
  | "unknown";

/**
 * Choix effectif d’extrusion — traçable dans les diagnostics.
 */
export type VolumeExtrusionChoice =
  | "along_pan_normal"
  | "vertical_world_z"
  | "hybrid_vertical_base_on_plane";

export interface VolumeRoofAttachment {
  /** Pan principal retenu pour la projection / la normale d’extrusion. */
  readonly primaryPlanePatchId: StableEntityId | null;
  /** Pans listés en entrée ou candidats (traçabilité). */
  readonly affectedPlanePatchIds: readonly StableEntityId[];
  readonly anchorKind: VolumeRoofAnchorKind;
  readonly relationHint: VolumeRoofRelationHint;
  readonly extrusionChoice: VolumeExtrusionChoice;
  /** Distance max |n·p+d| avant projection (m) si ancrage pan ; 0 si inconnu. */
  readonly maxPreProjectionPlaneDistanceM?: number;
}
