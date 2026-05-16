/**
 * Catalogue obstacle premium.
 *
 * Role: describe obstacle business semantics and visual/shading intent.
 * Non-goals: no runtime mutation, no geometry solving, no persistence migration.
 */

import type { RoofObstacleKind } from "../canonical3d/types/obstacle";
import type { RoofObstacleVisualRole } from "../canonical3d/types/roof-obstacle-volume";

export type PremiumRoofObstacleType =
  | "chimney_square"
  | "chimney_round"
  | "vmc_round"
  | "antenna"
  | "roof_window"
  | "keepout_zone"
  | "tree_shadow"
  | "parapet"
  | "roof_drain";

export type PremiumObstacleGeometryPrimitive =
  | "box"
  | "cylinder"
  | "flush_rect"
  | "surface"
  | "mast"
  | "canopy_proxy"
  | "linear_wall";

export type PremiumObstacleDetailProfile =
  | "brick_chimney_square"
  | "brick_chimney_round"
  | "metal_vent_cap"
  | "antenna_mast"
  | "roof_window_glass"
  | "keepout_hatch"
  | "shadow_canopy"
  | "parapet_cap"
  | "drain_cap";

export interface PremiumObstacleBusinessConfig {
  readonly type: PremiumRoofObstacleType;
  readonly label: string;
  readonly family: "physical_shading" | "non_shading_keepout" | "abstract_shadow";
  readonly canonicalKind: RoofObstacleKind;
  readonly visualRole: RoofObstacleVisualRole;
}

export interface PremiumObstacleGeometryConfig {
  readonly primitive: PremiumObstacleGeometryPrimitive;
  readonly defaultWidthM: number | null;
  readonly defaultDepthM: number | null;
  readonly defaultDiameterM: number | null;
  readonly defaultHeightM: number | null;
  readonly footprint: "rect" | "circle" | "polygon";
}

export interface PremiumObstacleRendering2DConfig {
  readonly stroke: string;
  readonly fill: string;
  readonly icon: "square" | "circle" | "vent" | "antenna" | "window" | "keepout" | "tree" | "parapet" | "drain";
  readonly dashed: boolean;
}

export interface PremiumObstacleRendering3DConfig {
  readonly materialProfile:
    | "brick"
    | "dark_brick"
    | "painted_metal"
    | "brushed_metal"
    | "glass"
    | "keepout_warning"
    | "shadow_volume"
    | "roof_edge_metal";
  readonly detailProfile: PremiumObstacleDetailProfile;
  readonly baseColor: string;
  readonly lineColor: string;
  readonly transparent: boolean;
  readonly opacity: number;
}

export interface PremiumObstacleShadingConfig {
  readonly castsNearShading: boolean;
  readonly blocksPvPlacement: boolean;
  readonly includeIn3DRaycast: boolean;
  readonly confidence: "measured_required" | "catalog_default_ok" | "visual_only";
}

export interface PremiumObstacleMetadataConfig {
  readonly exportStable: boolean;
  readonly fallbackStable: boolean;
  readonly description: string;
}

export interface PremiumRoofObstacleSpec {
  readonly business: PremiumObstacleBusinessConfig;
  readonly geometry: PremiumObstacleGeometryConfig;
  readonly rendering2d: PremiumObstacleRendering2DConfig;
  readonly rendering3d: PremiumObstacleRendering3DConfig;
  readonly shading: PremiumObstacleShadingConfig;
  readonly metadata: PremiumObstacleMetadataConfig;
}

export const PREMIUM_ROOF_OBSTACLE_CATALOG: Record<PremiumRoofObstacleType, PremiumRoofObstacleSpec> = {
  chimney_square: {
    business: {
      type: "chimney_square",
      label: "Cheminee carree",
      family: "physical_shading",
      canonicalKind: "chimney",
      visualRole: "physical_roof_body",
    },
    geometry: { primitive: "box", footprint: "rect", defaultWidthM: 0.6, defaultDepthM: 0.6, defaultDiameterM: null, defaultHeightM: 1.8 },
    rendering2d: { stroke: "#7c2d12", fill: "#fed7aa", icon: "square", dashed: false },
    rendering3d: { materialProfile: "brick", detailProfile: "brick_chimney_square", baseColor: "#b77961", lineColor: "#e0b195", transparent: false, opacity: 1 },
    shading: { castsNearShading: true, blocksPvPlacement: true, includeIn3DRaycast: true, confidence: "catalog_default_ok" },
    metadata: { exportStable: true, fallbackStable: true, description: "Opaque square chimney with brick details and flue opening." },
  },
  chimney_round: {
    business: {
      type: "chimney_round",
      label: "Cheminee ronde",
      family: "physical_shading",
      canonicalKind: "chimney",
      visualRole: "physical_roof_body",
    },
    geometry: { primitive: "cylinder", footprint: "circle", defaultWidthM: null, defaultDepthM: null, defaultDiameterM: 0.35, defaultHeightM: 2 },
    rendering2d: { stroke: "#7c2d12", fill: "#fed7aa", icon: "circle", dashed: false },
    rendering3d: { materialProfile: "brick", detailProfile: "brick_chimney_round", baseColor: "#b77961", lineColor: "#e0b195", transparent: false, opacity: 1 },
    shading: { castsNearShading: true, blocksPvPlacement: true, includeIn3DRaycast: true, confidence: "catalog_default_ok" },
    metadata: { exportStable: true, fallbackStable: true, description: "Opaque round chimney rendered as a cylinder with ring courses." },
  },
  vmc_round: {
    business: {
      type: "vmc_round",
      label: "VMC",
      family: "physical_shading",
      canonicalKind: "hvac",
      visualRole: "physical_roof_body",
    },
    geometry: { primitive: "cylinder", footprint: "circle", defaultWidthM: null, defaultDepthM: null, defaultDiameterM: 0.25, defaultHeightM: 0.3 },
    rendering2d: { stroke: "#0369a1", fill: "#bae6fd", icon: "vent", dashed: false },
    rendering3d: { materialProfile: "painted_metal", detailProfile: "metal_vent_cap", baseColor: "#d9e2ea", lineColor: "#64748b", transparent: false, opacity: 1 },
    shading: { castsNearShading: true, blocksPvPlacement: true, includeIn3DRaycast: true, confidence: "catalog_default_ok" },
    metadata: { exportStable: true, fallbackStable: true, description: "Low roof vent cap with metallic finish and vent slats." },
  },
  antenna: {
    business: {
      type: "antenna",
      label: "Antenne",
      family: "physical_shading",
      canonicalKind: "antenna",
      visualRole: "physical_roof_body",
    },
    geometry: { primitive: "mast", footprint: "circle", defaultWidthM: null, defaultDepthM: null, defaultDiameterM: 0.35, defaultHeightM: 1.5 },
    rendering2d: { stroke: "#334155", fill: "#cbd5e1", icon: "antenna", dashed: false },
    rendering3d: { materialProfile: "brushed_metal", detailProfile: "antenna_mast", baseColor: "#4b5563", lineColor: "#dbe4ee", transparent: true, opacity: 0.18 },
    shading: { castsNearShading: true, blocksPvPlacement: true, includeIn3DRaycast: true, confidence: "measured_required" },
    metadata: { exportStable: true, fallbackStable: true, description: "Antenna mast with base plate and directional rods." },
  },
  roof_window: {
    business: {
      type: "roof_window",
      label: "Velux",
      family: "non_shading_keepout",
      canonicalKind: "skylight",
      visualRole: "roof_window_flush",
    },
    geometry: { primitive: "flush_rect", footprint: "rect", defaultWidthM: 0.78, defaultDepthM: 0.98, defaultDiameterM: null, defaultHeightM: null },
    rendering2d: { stroke: "#0f766e", fill: "#ccfbf1", icon: "window", dashed: false },
    rendering3d: { materialProfile: "glass", detailProfile: "roof_window_glass", baseColor: "#6f879b", lineColor: "#d8e5ee", transparent: true, opacity: 0.52 },
    shading: { castsNearShading: false, blocksPvPlacement: true, includeIn3DRaycast: false, confidence: "visual_only" },
    metadata: { exportStable: true, fallbackStable: true, description: "Flush roof window; blocks PV placement but does not cast physical near shading." },
  },
  keepout_zone: {
    business: {
      type: "keepout_zone",
      label: "Zone non posable",
      family: "non_shading_keepout",
      canonicalKind: "other",
      visualRole: "keepout_surface",
    },
    geometry: { primitive: "surface", footprint: "polygon", defaultWidthM: 1, defaultDepthM: 1, defaultDiameterM: null, defaultHeightM: null },
    rendering2d: { stroke: "#dc2626", fill: "#fee2e2", icon: "keepout", dashed: true },
    rendering3d: { materialProfile: "keepout_warning", detailProfile: "keepout_hatch", baseColor: "#f59e0b", lineColor: "#fbbf24", transparent: true, opacity: 0.24 },
    shading: { castsNearShading: false, blocksPvPlacement: true, includeIn3DRaycast: false, confidence: "visual_only" },
    metadata: { exportStable: true, fallbackStable: true, description: "Forbidden PV placement surface with warning hatching." },
  },
  tree_shadow: {
    business: {
      type: "tree_shadow",
      label: "Arbre / ombre",
      family: "abstract_shadow",
      canonicalKind: "tree_proxy",
      visualRole: "abstract_shadow_volume",
    },
    geometry: { primitive: "canopy_proxy", footprint: "circle", defaultWidthM: null, defaultDepthM: null, defaultDiameterM: 2.5, defaultHeightM: 4 },
    rendering2d: { stroke: "#166534", fill: "#bbf7d0", icon: "tree", dashed: true },
    rendering3d: { materialProfile: "shadow_volume", detailProfile: "shadow_canopy", baseColor: "#64748b", lineColor: "#cbd5e1", transparent: true, opacity: 0.28 },
    shading: { castsNearShading: true, blocksPvPlacement: false, includeIn3DRaycast: true, confidence: "measured_required" },
    metadata: { exportStable: true, fallbackStable: true, description: "Abstract tree or remote shadow proxy volume for near-shading evaluation." },
  },
  parapet: {
    business: {
      type: "parapet",
      label: "Acrotere",
      family: "physical_shading",
      canonicalKind: "parapet",
      visualRole: "physical_roof_body",
    },
    geometry: { primitive: "linear_wall", footprint: "rect", defaultWidthM: 2, defaultDepthM: 0.25, defaultDiameterM: null, defaultHeightM: 0.45 },
    rendering2d: { stroke: "#475569", fill: "#e2e8f0", icon: "parapet", dashed: false },
    rendering3d: { materialProfile: "roof_edge_metal", detailProfile: "parapet_cap", baseColor: "#94a3b8", lineColor: "#e2e8f0", transparent: false, opacity: 1 },
    shading: { castsNearShading: true, blocksPvPlacement: true, includeIn3DRaycast: true, confidence: "catalog_default_ok" },
    metadata: { exportStable: true, fallbackStable: true, description: "Low parapet or roof-edge wall with cap detail." },
  },
  roof_drain: {
    business: {
      type: "roof_drain",
      label: "Evacuation",
      family: "physical_shading",
      canonicalKind: "drain",
      visualRole: "physical_roof_body",
    },
    geometry: { primitive: "cylinder", footprint: "circle", defaultWidthM: null, defaultDepthM: null, defaultDiameterM: 0.18, defaultHeightM: 0.12 },
    rendering2d: { stroke: "#475569", fill: "#e5e7eb", icon: "drain", dashed: false },
    rendering3d: { materialProfile: "brushed_metal", detailProfile: "drain_cap", baseColor: "#cbd5e1", lineColor: "#64748b", transparent: false, opacity: 1 },
    shading: { castsNearShading: true, blocksPvPlacement: true, includeIn3DRaycast: true, confidence: "catalog_default_ok" },
    metadata: { exportStable: true, fallbackStable: true, description: "Small roof drain or evacuation cap." },
  },
};

export function getPremiumRoofObstacleSpec(id: string | null | undefined): PremiumRoofObstacleSpec | null {
  if (!id || typeof id !== "string") return null;
  if (id === "generic_polygon_keepout" || id === "dormer_keepout") return PREMIUM_ROOF_OBSTACLE_CATALOG.keepout_zone;
  if (id === "legacy_shadow_cube" || id === "legacy_shadow_tube") return PREMIUM_ROOF_OBSTACLE_CATALOG.tree_shadow;
  return PREMIUM_ROOF_OBSTACLE_CATALOG[id as PremiumRoofObstacleType] ?? null;
}
