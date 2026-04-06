/**
 * Maillage volumique minimal (obstacles / extensions) — entités distinctes du maillage toiture.
 *
 * Convention : indices 0..N-1 dans les faces référencent le tableau `vertices` du volume parent.
 * Normales de face **sortantes** (hors solide) pour tests d’intersection / raycast futurs.
 */

import type { StableEntityId, Vector3 } from "./primitives";
import type { WorldPosition3D } from "./coordinates";

/** Sommet appartenant à un volume canonique. */
export interface VolumeVertex3D {
  readonly id: StableEntityId;
  readonly position: WorldPosition3D;
}

export type VolumeEdgeKind = "base" | "top" | "lateral" | "other";

export interface VolumeEdge3D {
  readonly id: StableEntityId;
  readonly vertexAIndex: number;
  readonly vertexBIndex: number;
  readonly kind: VolumeEdgeKind;
}

export type VolumeFaceKind = "base" | "top" | "side" | "cap" | "other";

export interface VolumeFace3D {
  readonly id: StableEntityId;
  readonly kind: VolumeFaceKind;
  /** Cycle d’indices dans le tableau de sommets du volume (fermé implicite ou répété premier point selon validation). */
  readonly vertexIndexCycle: readonly number[];
  /** Normale unitaire sortante (WORLD). */
  readonly outwardUnitNormal: Vector3;
  readonly areaM2: number;
}

/** Boîte englobante alignée axes WORLD (AABB). */
export interface AxisAlignedBounds3D {
  readonly min: WorldPosition3D;
  readonly max: WorldPosition3D;
}
