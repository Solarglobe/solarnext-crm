/**

 * Extension / lucarne comme volume 3D explicite.

 */



import type { WorldPosition3D } from "./coordinates";

import type { GeometryProvenance } from "./provenance";

import type { QualityBlock } from "./quality";

import type { StableEntityId } from "./primitives";

import type { RoofExtensionKind } from "./extension";

import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "./volumetric-mesh";

import type { ObstacleVolumeExtrusionSpec } from "./roof-obstacle-volume";

import type { VolumeRoofAttachment } from "./volume-roof-attachment";



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

}


