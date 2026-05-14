/**
 * Contrat d’entrée du builder volumique — aucune dépendance au runtime calpinage.
 *
 * Pipeline canonical (volumes) : docs/architecture/canonical-pipeline.md
 */

import type { WorldPosition3D } from "../types/coordinates";
import type { RoofExtensionKind } from "../types/extension";
import type { RoofObstacleKind } from "../types/obstacle";
import type { RoofObstacleVisualRole } from "../types/roof-obstacle-volume";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofVolumeStructuralRole } from "../types/roof-volume-common";

/**
 * - `auto` : si un pan est résolu depuis `roofPlanePatches` + `relatedPlanePatchIds`, extrusion le long de la normale du pan ; sinon +Z monde.
 * - `along_pan_normal` / `hybrid_vertical_on_plane` : exigent un pan résolu, sinon repli + diagnostic.
 */
export type VolumeExtrusionPreference =
  | "auto"
  | "vertical_world_z"
  | "along_pan_normal"
  | "hybrid_vertical_on_plane";

export type VolumeTopSurfaceMode = "parallel_to_base" | "horizontal_flat";

/** Point image pour footprint horizontal (même convention que le builder toiture). */
export interface VolumeImagePoint2D {
  readonly xPx: number;
  readonly yPx: number;
}

/**
 * Footprint soit déjà en WORLD (m), soit en pixels image + échelle + Z de base.
 */
export type LegacyVolumeFootprintSource =
  | {
      readonly mode: "world";
      /** Polygone fermé coplanaire horizontal (Z constant ou quasi — le builder aplatit sur la moyenne Z). */
      readonly footprintWorld: readonly WorldPosition3D[];
    }
  | {
      readonly mode: "image_px";
      readonly polygonPx: readonly VolumeImagePoint2D[];
      readonly metersPerPixel: number;
      readonly northAngleDeg: number;
      /** Z monde (m) de la base d’extrusion pour tous les sommets du footprint. */
      readonly baseElevationM: number;
    };

export interface LegacyObstacleVolumeInput {
  readonly id: string;
  readonly kind: RoofObstacleKind;
  /** Doit être `obstacle_simple` ou `obstacle_structuring` (pas `roof_extension`). */
  readonly structuralRole: Exclude<RoofVolumeStructuralRole, "roof_extension">;
  readonly visualRole?: RoofObstacleVisualRole;
  readonly heightM: number;
  readonly footprint: LegacyVolumeFootprintSource;
  readonly relatedPlanePatchIds?: readonly string[];
  readonly extrusionPreference?: VolumeExtrusionPreference;
  readonly topSurfaceMode?: VolumeTopSurfaceMode;
}

export interface LegacyExtensionVolumeInput {
  readonly id: string;
  readonly kind: RoofExtensionKind;
  readonly heightM: number;
  readonly footprint: LegacyVolumeFootprintSource;
  readonly relatedPlanePatchIds?: readonly string[];
  readonly parentModelRef?: string;
  readonly extrusionPreference?: VolumeExtrusionPreference;
}

export interface BuildRoofVolumes3DInput {
  readonly obstacles: readonly LegacyObstacleVolumeInput[];
  readonly extensions: readonly LegacyExtensionVolumeInput[];
}

/** Contexte optionnel : pans issus de `buildRoofModel3DFromLegacyGeometry` (ou équivalent) pour ancrage roof-aware. */
export interface BuildRoofVolumes3DContext {
  readonly roofPlanePatches?: readonly RoofPlanePatch3D[];
}
