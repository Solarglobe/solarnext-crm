/**

 * Extension / lucarne comme volume 3D explicite.

 */



import type { WorldPosition3D } from "./coordinates";

import type { GeometryProvenance } from "./provenance";

import type { QualityBlock } from "./quality";

import type { StableEntityId, Vector3 } from "./primitives";

import type { RoofExtensionKind } from "./extension";

import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "./volumetric-mesh";

import type { ObstacleVolumeExtrusionSpec } from "./roof-obstacle-volume";

import type { VolumeRoofAttachment } from "./volume-roof-attachment";



export type RoofExtensionTopologyVersion = "roof_extension_topology_v2" | "roof_extension_topology_v3";

export type RoofExtensionMiniRoofSemanticVersion = "roof_extension_mini_roof_semantics_v1";

export type RoofExtensionMiniRoofFaceRole =
  | "support_footprint"
  | "cheek_wall"
  | "front_wall"
  | "rear_wall"
  | "mini_roof_plane"
  | "ridge_cap"
  | "unknown";

export type RoofExtensionMiniRoofEdgeRole =
  | "support_seam"
  | "base_keepout"
  | "side_wall_edge"
  | "mini_roof_eave"
  | "ridge"
  | "hip"
  | "unknown";

export interface RoofExtensionMiniRoofFaceSemantic {
  readonly faceId: StableEntityId;
  readonly role: RoofExtensionMiniRoofFaceRole;
}

export interface RoofExtensionMiniRoofEdgeSemantic {
  readonly edgeId: StableEntityId;
  readonly roles: readonly RoofExtensionMiniRoofEdgeRole[];
}

export interface RoofExtensionMiniRoofKeepoutSemantic {
  readonly source: "footprint";
  readonly footprintWorldVertexIds: readonly StableEntityId[];
  readonly supportPlanePatchId: StableEntityId;
}

export interface RoofExtensionMiniRoofSemantics {
  readonly version: RoofExtensionMiniRoofSemanticVersion;
  readonly hasCheeks: boolean;
  readonly hasRidge: boolean;
  readonly hasMiniRoofPlanes: boolean;
  readonly hasSupportSeam: boolean;
  readonly faceRoles: readonly RoofExtensionMiniRoofFaceSemantic[];
  readonly edgeRoles: readonly RoofExtensionMiniRoofEdgeSemantic[];
  readonly keepout: RoofExtensionMiniRoofKeepoutSemantic;
  readonly diagnostics: readonly string[];
}

export interface RoofExtensionSourcePointTopology2D {
  readonly x: number;
  readonly y: number;
  readonly heightRelM: number;
}

export interface RoofExtensionTopologyMetadata {
  readonly version: RoofExtensionTopologyVersion;
  /** v3 hips_aware : maillage depuis contour + hips + ridge + apex ; v2 fallback éventuel */
  readonly meshStrategy?: "hips_aware" | "contour_ridge_fan";
  readonly source: "roofExtensions.runtime.contour_ridge";
  readonly heightReference: "support_plane_normal";
  readonly supportPlanePatchId: StableEntityId;
  readonly supportPlaneNormal: Vector3;
  readonly ignoredLegacyCanonicalDormerGeometry: boolean;
  readonly sourceContourPx: readonly RoofExtensionSourcePointTopology2D[];
  readonly sourceRidgePx: {
    readonly a: RoofExtensionSourcePointTopology2D;
    readonly b: RoofExtensionSourcePointTopology2D;
  };
  /** Sommet central unique (hips / faîtage) persisté en pixels image ; même identité que mesh.vertices pour ce sommet */
  readonly apexVertexPx?: {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly heightRelM: number;
  };
  readonly miniRoof?: RoofExtensionMiniRoofSemantics;
}



export interface RoofExtensionVolume3D {

  readonly id: StableEntityId;

  readonly kind: RoofExtensionKind;

  readonly structuralRole: "roof_extension";

  readonly baseElevationM: number;

  readonly heightM: number;

  readonly extrusion: ObstacleVolumeExtrusionSpec;

  readonly footprintWorld: readonly WorldPosition3D[];

  readonly vertices: readonly VolumeVertex3D[];

  readonly edges: readonly VolumeEdge3D[];

  readonly faces: readonly VolumeFace3D[];

  readonly bounds: AxisAlignedBounds3D;

  readonly centroid: WorldPosition3D;

  readonly surfaceAreaM2: number;

  readonly volumeM3: number;

  readonly relatedPlanePatchIds: readonly StableEntityId[];

  readonly roofAttachment: VolumeRoofAttachment;

  readonly parentModelRef?: StableEntityId;

  readonly provenance: GeometryProvenance;

  readonly quality: QualityBlock;

  readonly topology?: RoofExtensionTopologyMetadata;

}


