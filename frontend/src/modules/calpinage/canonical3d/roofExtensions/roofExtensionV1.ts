import type { RoofExtensionKind } from "../types/extension";

export type RoofExtensionV1Version = "roof_extension_v1";

export type RoofExtensionTopologyTypeV1 = "gable_dormer" | "shed_dormer" | "flat_extension";

export type RoofExtensionWinding2D = "counter_clockwise" | "clockwise";

export interface RoofExtensionPointPxV1 {
  readonly x: number;
  readonly y: number;
  /** Hauteur relative au pan support, en metres. */
  readonly heightRelM: number;
}

export interface RoofExtensionSegmentPxV1 {
  readonly a: RoofExtensionPointPxV1;
  readonly b: RoofExtensionPointPxV1;
}

export interface RoofExtensionHipsV1 {
  readonly left?: RoofExtensionSegmentPxV1;
  readonly right?: RoofExtensionSegmentPxV1;
}

export interface RoofExtensionDimensionsV1 {
  readonly widthM: number;
  readonly depthM: number;
  readonly footprintAreaM2: number;
  readonly wallHeightM: number;
  readonly roofHeightM: number;
  readonly totalHeightM: number;
}

export interface RoofExtensionOrientationV1 {
  /** Direction du faitage dans l'image, normalisee. */
  readonly ridgeAxisPx: { readonly x: number; readonly y: number };
  /** Direction principale depuis faitage vers footprint, normalisee et deterministe. */
  readonly depthAxisPx: { readonly x: number; readonly y: number };
  readonly ridgeAngleDeg: number;
}

export interface RoofExtensionRoofParametersV1 {
  readonly topologyType: RoofExtensionTopologyTypeV1;
  readonly pitchDeg: number | null;
  readonly eaveOffsetM: number;
  readonly seamOffsetM: number;
}

export interface RoofExtensionRenderParametersV1 {
  readonly materialFamily: "roof_extension_premium";
  readonly showDebugLines: false;
  readonly selectable: true;
}

export interface RoofExtensionPvMetadataV1 {
  readonly keepoutSource: "footprint";
  readonly keepoutOffsetM: number;
  readonly shadowSource: "canonical_mesh";
  readonly raycastSource: "canonical_mesh";
}

export interface RoofExtensionV1 {
  readonly version: RoofExtensionV1Version;
  readonly id: string;
  readonly kind: RoofExtensionKind;
  readonly supportPanId: string;
  readonly footprintPx: readonly RoofExtensionPointPxV1[];
  readonly footprintWinding: RoofExtensionWinding2D;
  readonly ridgePx: RoofExtensionSegmentPxV1;
  readonly hipsPx: RoofExtensionHipsV1 | null;
  readonly apexId: string | null;
  readonly apexPx: RoofExtensionPointPxV1 | null;
  readonly dimensions: RoofExtensionDimensionsV1;
  readonly orientation: RoofExtensionOrientationV1;
  readonly roof: RoofExtensionRoofParametersV1;
  readonly render: RoofExtensionRenderParametersV1;
  readonly pv: RoofExtensionPvMetadataV1;
  readonly provenance: {
    readonly source: "legacy_runtime_roof_extension";
    readonly sourceIndex: number;
    readonly inferredSupportPanId: boolean;
    readonly ignoredLegacyFields: readonly string[];
  };
}
