/**
 * Sortie monde / scène dérivée du `CanonicalHouseDocument` (repère local bâtiment).
 * Ne contient pas de re-lecture runtime ; transformations explicites uniquement.
 *
 * @see docs/architecture/canonical-house3d-local-to-world.md
 * @see docs/architecture/3d-world-convention.md
 */

import type { CanonicalHouseEntityId } from "./canonicalHouse3DModel";

export const CANONICAL_HOUSE_WORLD_SCENE_SCHEMA_ID = "canonical-house3d-world-scene-v1" as const;

/** Position monde / scène (m) — ENU Z-up, identique au viewer officiel SolarScene3D. */
export interface WorldVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Repère monde verrouillé : aligné sur `unifiedWorldFrame` / `worldConvention` / `3d-world-convention.md`.
 * Le viewer Three.js officiel applique l’identité sur (x,y,z) mètres.
 */
export interface SceneFrameDescriptor {
  readonly conventionId: "ENU_Z_UP_OFFICIAL";
  readonly horizontalAxis1: "+X";
  readonly horizontalAxis2: "+Y";
  readonly verticalAxis: "+Z";
  readonly viewerPositionMapping: "identity_xyz_meters";
  readonly referenceDocs: readonly string[];
  /** Nord calpinage (deg) — métadonnée de contexte ; ne doit pas être ré-appliqué si le local est déjà issu de imagePxToWorldHorizontalM. */
  readonly northAngleDegContext?: number;
  readonly metersPerPixelContext?: number;
}

export type WorldAdaptDiagnosticSeverity = "blocking" | "warning" | "info";

export type WorldAdaptDiagnosticSubject =
  | "local_geometry"
  | "world_placement"
  | "viewer_context"
  | "satellite"
  | "transform_chain";

export interface WorldAdaptDiagnostic {
  readonly code: string;
  readonly severity: WorldAdaptDiagnosticSeverity;
  readonly message: string;
  readonly subject?: WorldAdaptDiagnosticSubject;
  readonly path?: string;
}

export interface TransformStepProvenance {
  readonly stepId: string;
  readonly description: string;
  readonly formula?: string;
}

export interface WorldPolygon3DRing {
  readonly ringId: string;
  readonly points: readonly WorldVec3[];
  /** Sens des points inchangé par rapport au canonique (pas de correction silencieuse de winding). */
  readonly windingPolicy: "pass_through_from_canonical";
}

export interface WorldBuildingSceneBlock {
  readonly buildingId: CanonicalHouseEntityId;
  readonly footprintWorld: WorldPolygon3DRing;
  readonly outerContourWorld: WorldPolygon3DRing;
}

export interface WorldRoofPatchSceneGeometry {
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly boundaryLoopWorld: readonly WorldVec3[];
  readonly dataStatus: string;
}

export interface WorldRoofEdgeSceneSegment {
  readonly edgeId: CanonicalHouseEntityId;
  readonly segmentWorld: readonly [WorldVec3, WorldVec3];
}

export interface WorldRoofSceneBlock {
  readonly roofId: CanonicalHouseEntityId;
  readonly patches: readonly WorldRoofPatchSceneGeometry[];
  readonly edgeSegmentsWorld: readonly WorldRoofEdgeSceneSegment[];
}

export interface WorldAnnexSceneBlock {
  readonly annexId: CanonicalHouseEntityId;
  readonly family: string;
  readonly bottomRingWorld?: WorldPolygon3DRing;
  readonly topRingWorld?: WorldPolygon3DRing;
  readonly placeholderNote?: string;
}

export interface WorldPvPanelScene {
  readonly panelInstanceId: CanonicalHouseEntityId;
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly positionWorld: WorldVec3;
  readonly rotationDegAroundMountNormal: number;
}

export interface WorldPvSceneBlock {
  readonly groups: readonly { readonly groupId: CanonicalHouseEntityId; readonly panelInstanceIds: readonly string[] }[];
  readonly panels: readonly WorldPvPanelScene[];
}

/** Plan satellite / fond : support visuel monde — ne corrige pas la géométrie métier. */
export interface SatelliteBackdropWorld {
  readonly backdropId: "satellite-image-plane";
  readonly cornersWorld: readonly WorldVec3[];
  readonly normalWorld: WorldVec3;
  readonly zOffsetM: number;
  readonly halfWidthM: number;
  readonly halfHeightM: number;
  readonly metadata: {
    readonly metersPerPixel: number;
    readonly northAngleDeg: number;
    readonly imageWidthPx: number;
    readonly imageHeightPx: number;
  };
}

/**
 * Entrée scène monde pour viewer / assembleur Three.js — dérivée exclusivement du canonique + options d’adaptation.
 */
export interface CanonicalHouseWorldDocument {
  readonly schemaId: typeof CANONICAL_HOUSE_WORLD_SCENE_SCHEMA_ID;
  readonly sceneFrame: SceneFrameDescriptor;
  readonly building: WorldBuildingSceneBlock;
  readonly roof: WorldRoofSceneBlock;
  readonly annexes: readonly WorldAnnexSceneBlock[];
  readonly pv?: WorldPvSceneBlock;
  readonly satelliteBackdrop?: SatelliteBackdropWorld;
  /** GPS contexte affichage — jamais utilisé pour déformer la géométrie maison. */
  readonly gpsContext?: Readonly<{ lat: number; lon: number }>;
}

/** Alias demandé (prompt 2C) — même contrat que `CanonicalHouseWorldDocument`. */
export type House3DWorldSceneInput = CanonicalHouseWorldDocument;

export interface AdaptCanonicalHouseLocalToWorldSceneResult {
  readonly scene: CanonicalHouseWorldDocument;
  readonly diagnostics: readonly WorldAdaptDiagnostic[];
  readonly transformProvenance: readonly TransformStepProvenance[];
  /** Politique mathématique locale → monde (sans re-rotation nord sur les sommets si identité). */
  readonly localToWorldNumericPolicy: "identity_local_xy_z_to_ENU_scene_meters";
  readonly worldTransformValid: boolean;
}
