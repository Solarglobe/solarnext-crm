/**
 * Panneaux PV comme surfaces 3D canoniques (couche additive, non branchée au runtime placement).
 */

import type { PlaneFrameUv2D, WorldPosition3D } from "./coordinates";
import type { LocalFrame3D } from "./frame";
import type { PlaneEquation } from "./plane";
import type { GeometryProvenance } from "./provenance";
import type { QualityBlock } from "./quality";
import type { StableEntityId, Vector3 } from "./primitives";
import type { PvPanelSpatialContext3D } from "./pv-panel-context-3d";

/** Portrait : grand côté du module le long de l’axe tangent V du pan ; paysage : le long de U. */
export type PvPanelOrientation2D = "portrait" | "landscape";

/**
 * Qualité de l’ancrage au pan (pas de solveur multi-pans dans cette passe).
 */
export type PvPanelAttachmentKind =
  | "single_plane_resolved"
  | "plane_patch_not_found"
  | "center_projected_onto_plane"
  | "degraded_frame";

export type PvPanelRelationHint =
  | "seated_on_single_plane"
  | "pose_ambiguous_multi_plane_not_supported"
  | "near_plane_boundary_unknown";

/** Paramètres de grille d’échantillonnage sur la surface (repère panneau normalisé). */
export interface PvPanelSamplingParams {
  readonly nx: number;
  readonly ny: number;
  /** Si true : ajoute échantillons sur les bords (milieux d’arêtes) + centre déjà couvert si nx,ny>0. */
  readonly includeEdgeMidpoints: boolean;
}

/**
 * Grille géométrique 3D sur le rectangle du panneau (pas décorative : points sur le plan du module).
 */
export interface PvPanelGrid3D {
  readonly params: PvPanelSamplingParams;
  /** Centres de cellules régulières en WORLD, ordre row-major : i=0..nx-1 (selon largeur locale), j=0..ny-1 (selon hauteur locale). */
  readonly cellCentersWorld: readonly WorldPosition3D[];
  /** Coordonnées paramétriques [0,1]² dans le repère panneau (origine coin « bas-gauche », u le long largeur, v le long hauteur). */
  readonly cellUv01: readonly PlaneFrameUv2D[];
  /** Les 4 coins du panneau (ordre cohérent avec `PvPanelSurface3D.corners3D`). */
  readonly cornerPointsWorld: readonly WorldPosition3D[];
  readonly centerWorld: WorldPosition3D;
  /** Optionnel : milieux des 4 arêtes (si includeEdgeMidpoints). */
  readonly edgeMidpointsWorld?: readonly WorldPosition3D[];
}

/** Rattachement explicite au patch de toiture. */
export interface PvPanelAttachment3D {
  readonly roofPlanePatchId: StableEntityId;
  readonly kind: PvPanelAttachmentKind;
  readonly relationHint: PvPanelRelationHint;
  /** Distance signée centre → plan avant projection (m) si entrée monde ; 0 si déjà dans le plan. */
  readonly signedDistanceCenterToPlaneM: number;
}

/** Métadonnées de pose (traçabilité, pas de logique runtime legacy). */
export interface PvPanelPoseMetadata {
  readonly orientation: PvPanelOrientation2D;
  /** Rotation dans le plan du pan, en degrés, CCW vue depuis l’extérieur (le long de la normale sortante). */
  readonly rotationDegInPlane: number;
  readonly widthM: number;
  readonly heightM: number;
  /** Groupe logique (ex. « bloc » de strings) — optionnel. */
  readonly blockGroupId?: StableEntityId;
}

/**
 * Surface 3D d’un module : quad planaire posé sur un pan.
 * Ordre des coins : CCW vue depuis l’extérieur du volume sous toiture (le long de `outwardNormal`).
 */
export interface PvPanelSurface3D {
  readonly id: StableEntityId;
  readonly corners3D: readonly [WorldPosition3D, WorldPosition3D, WorldPosition3D, WorldPosition3D];
  readonly center3D: WorldPosition3D;
  /** Normale unitaire sortante (« ciel »), alignée sur le pan. */
  readonly outwardNormal: Vector3;
  readonly planeEquation: PlaneEquation;
  /** Repère panneau : origine au centre, z = normale sortante, x = direction « largeur », y = « hauteur » module. */
  readonly localFrame: LocalFrame3D;
  readonly widthM: number;
  readonly heightM: number;
  readonly surfaceAreaM2: number;
  readonly attachment: PvPanelAttachment3D;
  readonly pose: PvPanelPoseMetadata;
  readonly samplingGrid: PvPanelGrid3D;
  /** Contexte géométrique local (bord de pan, lignes structurantes, volumes) — toujours renseigné par le builder. */
  readonly spatialContext: PvPanelSpatialContext3D;
  readonly provenance: GeometryProvenance;
  readonly quality: QualityBlock;
}

export interface PvPanelBuildResult {
  readonly panels: readonly PvPanelSurface3D[];
  readonly globalQuality: QualityBlock;
}
