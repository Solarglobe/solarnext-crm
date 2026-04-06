/**

 * Obstacle toiture comme volume 3D explicite (prisme : vertical monde et/ou le long du pan).

 */



import type { WorldPosition3D } from "./coordinates";

import type { GeometryProvenance } from "./provenance";

import type { QualityBlock } from "./quality";

import type { StableEntityId, Vector3 } from "./primitives";

import type { RoofObstacleKind } from "./obstacle";

import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "./volumetric-mesh";

import type { RoofVolumeStructuralRole } from "./roof-volume-common";

import type { VolumeRoofAttachment } from "./volume-roof-attachment";



/**

 * - `vertical_world_z` : repli +Z monde, base horizontalisée (pas de pan fiable ou préférence explicite).

 * - `along_pan_normal` : base projetée sur le plan du pan, extrusion le long de la normale extérieure du pan.

 * - `hybrid_vertical_on_plane` : base sur le plan du pan, extrusion +Z monde (ex. souche verticale sur pente).

 */

export type ObstacleVolumeExtrusionMode =

  | "vertical_world_z"

  | "along_pan_normal"

  | "hybrid_vertical_on_plane";



export interface ObstacleVolumeExtrusionSpec {

  readonly mode: ObstacleVolumeExtrusionMode;

  /** Direction monde unitaire d’extrusion effective (normale pan, ou +Z). */

  readonly directionWorld: Vector3;

}



export interface RoofObstacleVolume3D {

  readonly id: StableEntityId;

  readonly kind: RoofObstacleKind;

  readonly structuralRole: RoofVolumeStructuralRole;

  readonly baseElevationM: number;

  readonly heightM: number;

  readonly extrusion: ObstacleVolumeExtrusionSpec;

  /** Contour de base utilisé (horizontal repli, ou projeté sur le pan selon le mode). */

  readonly footprintWorld: readonly WorldPosition3D[];

  readonly vertices: readonly VolumeVertex3D[];

  readonly edges: readonly VolumeEdge3D[];

  readonly faces: readonly VolumeFace3D[];

  readonly bounds: AxisAlignedBounds3D;

  readonly centroid: WorldPosition3D;

  /** Somme des aires des faces. */

  readonly surfaceAreaM2: number;

  readonly volumeM3: number;

  readonly relatedPlanePatchIds: readonly StableEntityId[];

  /** Ancrage toiture : toujours renseigné par le builder (repli explicite si pas de pan). */

  readonly roofAttachment: VolumeRoofAttachment;

  readonly provenance: GeometryProvenance;

  readonly quality: QualityBlock;

}


