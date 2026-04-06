/**
 * Coque bâtiment 3D — sortie du builder `buildBuildingShell3D` (extrusion verticale du footprint).
 * Repère : local bâtiment (m), Z up — aligné `canonicalHouse3DModel`.
 *
 * @see docs/architecture/building-shell-3d.md
 */

import type { BuildingLocalVec3, CanonicalHouseEntityId } from "./canonicalHouse3DModel";

export const BUILDING_SHELL_SCHEMA_ID = "building-shell-3d-v1" as const;

export interface BuildingShellVertex3D {
  readonly vertexId: string;
  readonly position: BuildingLocalVec3;
}

export interface BuildingShellSegment3D {
  readonly segmentId: string;
  readonly vertexIdA: string;
  readonly vertexIdB: string;
  readonly lengthM: number;
}

/** Anneau fermé bas ou haut. */
export interface BuildingShellRing3D {
  readonly ringId: string;
  readonly vertices: readonly BuildingShellVertex3D[];
  readonly segments: readonly BuildingShellSegment3D[];
  /** true si le dernier segment relie le dernier sommet au premier. */
  readonly closed: true;
}

/**
 * Mur latéral : quadrilatère vertical [b0, b1, t1, t0] en CCW vu depuis l’extérieur (normale sortante).
 */
export interface BuildingWallFace3D {
  readonly wallId: string;
  readonly segmentIndex: number;
  readonly bottomVertexIds: readonly [string, string];
  readonly topVertexIds: readonly [string, string];
  readonly polygon: readonly [BuildingLocalVec3, BuildingLocalVec3, BuildingLocalVec3, BuildingLocalVec3];
  readonly outwardNormal: BuildingLocalVec3;
  readonly heightM: number;
  readonly lengthM: number;
  /** Direction horizontale du bas du mur (b0→b1), unitaire. */
  readonly edgeDirectionXY: Readonly<{ x: number; y: number }>;
}

export interface BuildingShell3D {
  readonly schemaId: typeof BUILDING_SHELL_SCHEMA_ID;
  readonly buildingId: CanonicalHouseEntityId;
  readonly baseZ: number;
  readonly topZ: number;
  readonly bottomRing: BuildingShellRing3D;
  readonly topRing: BuildingShellRing3D;
  /** Une face par segment utile du footprint normalisé. */
  readonly wallFaces: readonly BuildingWallFace3D[];
  readonly provenance: {
    readonly source: "canonical_house_document";
    readonly buildingFootprintSource: "building.buildingFootprint";
    readonly heightSource: "input.zWallTop" | "input.wallHeightM" | "building.wallHeightM";
  };
}

export type BuildingShellWinding = "ccw" | "cw" | "degenerate";

export interface BuildingShellBuildDiagnostics {
  readonly isValid: boolean;
  /** Coque latérale fermée : un mur par arête du contour fermé, sans trou. */
  readonly isClosedLateralShell: boolean;
  readonly wallCount: number;
  readonly bottomVertexCount: number;
  readonly topVertexCount: number;
  /** Segments du contour initial écartés comme dégénérés (longueur ~0 ou doublons consécutifs). */
  readonly degenerateSegmentCount: number;
  readonly windingDetected: BuildingShellWinding;
  /** true si toutes les normales mur sont unitaires et alignées avec la géométrie attendue. */
  readonly normalsConsistent: boolean;
  readonly baseZ: number;
  readonly topZ: number;
  readonly heightUsed: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly perimeterM: number;
  readonly lateralSurfaceAreaM2: number;
  /** Aire signée du footprint (plan XY) avant normalisation d’orientation. */
  readonly footprintSignedAreaM2: number;
}

export interface BuildBuildingShell3DResult {
  readonly shell: BuildingShell3D | null;
  readonly diagnostics: BuildingShellBuildDiagnostics;
}
