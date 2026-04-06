/**
 * Contrat d’entrée du builder panneaux 3D — aucune dépendance au runtime placement / panelProjection.
 */

import type { PlaneFrameUv2D, WorldPosition3D } from "../types/coordinates";
import type { RoofEdgeSemanticKind } from "../types/edge";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { PvPanelOrientation2D } from "../types/pv-panel-3d";
import type { StableEntityId } from "../types/primitives";

/**
 * Segment structurant 3D (faîtage, rupture, arête partagée) — fourni par l’appelant, sans couplage runtime.
 */
export interface StructuralLineSegment3D {
  readonly id: StableEntityId;
  readonly endpointAWorld: WorldPosition3D;
  readonly endpointBWorld: WorldPosition3D;
  readonly semanticKind: RoofEdgeSemanticKind | "shared_inter_pan" | "break_line";
  readonly incidentPlanePatchIds: readonly StableEntityId[];
}

/** Centre du panneau : soit en UV du repère du pan, soit en WORLD (projeté sur le plan). */
export type PvPanelCenterInput =
  | { readonly mode: "plane_uv"; readonly uv: PlaneFrameUv2D }
  | { readonly mode: "world"; readonly position: WorldPosition3D };

/** Un module à matérialiser en surface 3D. */
export interface PvPanelPlacementInput {
  readonly id: StableEntityId;
  readonly roofPlanePatchId: StableEntityId;
  readonly center: PvPanelCenterInput;
  /** Dimensions physiques du module (m). */
  readonly widthM: number;
  readonly heightM: number;
  readonly orientation: PvPanelOrientation2D;
  /** Rotation dans le plan du pan (deg), CCW vue depuis l’extérieur (normale sortante). */
  readonly rotationDegInPlane: number;
  /** Grille d’échantillonnage ; défaut raisonnable si absent. */
  readonly sampling?: {
    readonly nx: number;
    readonly ny: number;
    readonly includeEdgeMidpoints?: boolean;
  };
  readonly blockGroupId?: StableEntityId;
}

export interface BuildPvPanels3DInput {
  readonly panels: readonly PvPanelPlacementInput[];
}

/** Contexte enrichi : patches + lignes / volumes optionnels (non branchés prod). */
export interface BuildPvPanels3DContext {
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  /** Segments incidents au pan courant (filtrés par `incidentPlanePatchIds`). */
  readonly structuralLineSegments?: readonly StructuralLineSegment3D[];
  readonly obstacleVolumes?: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes?: readonly RoofExtensionVolume3D[];
}
