/**
 * Contrat canonique — modèle de hauteur par point (Prompt 21).
 *
 * Types purs, hiérarchies et garde-fous documentés.
 * La logique métier reste dans heightResolver, heightConstraints, pans-bundle, adaptateurs.
 *
 * Référence : docs/architecture/canonical-height-point-model.md
 */

import type { HeightResolverContext, HeightResolutionResult, ResolveHeightOptions } from "../../core/heightResolver";

// ─── Définition officielle ─────────────────────────────────────────────────

/** Point 3D monde : x,y horizontal (m), z = hauteur bâtiment locale repère projet (m). */
export type CanonicalPoint3D = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/** Rôle du point pour la résolution verticale (choix de branche, pas une enum runtime legacy). */
export type CanonicalHeightPointKind =
  | "building_contour"
  | "pan_vertex"
  | "structural_line_endpoint"
  | "structural_line_interior"
  | "obstacle_footprint"
  | "roof_extension_footprint"
  | "generic_roof_sample";

/** Discrimination sémantique — ce que représente une grandeur (pas interchangeable avec z). */
export type CanonicalVerticalQuantityKind =
  | "building_height_z" // cote z repère projet
  | "relative_extrusion_m" // obstacle / extension au-dessus du toit local
  | "module_dimension_m" // largeur/hauteur module PV
  | "angle_deg" // pente, azimut, orientation
  | "solar_or_horizon_angle_deg" // soleil, masque horizon
  | "terrain_altitude_out_of_scope" // explicite : hors modèle calpinage
  | "legacy_viewer_axis_m"; // houseModelV2 — non canonique

// ─── Hiérarchies officielles (ordre décroissant = priorité) ────────────────

/** Toiture / contour / structurant — aligné sur heightConstraints + heightResolver. */
export const CANONICAL_ROOF_Z_RESOLUTION_ORDER = [
  "explicit_vertex_or_polygon_heightM",
  "structural_ridge_endpoint_snap",
  "structural_trait_endpoint_snap",
  "structural_line_interpolated_ridge",
  "structural_line_interpolated_trait",
  "pan_plane_fit_getHeightAtXY",
  "pan_local_mean_explicit",
  "global_explicit_mean",
  "default_global_fallback",
] as const;

export type CanonicalRoofZResolutionStep = (typeof CANONICAL_ROOF_Z_RESOLUTION_ORDER)[number];

/** Surhauteur obstacle / extension (m) — ordre de lecture métier. */
export const CANONICAL_RELATIVE_HEIGHT_RESOLUTION_ORDER = [
  "explicit_runtime_height_fields",
  "catalog_default_heightM",
  "shadow_volume_default",
  "legacy_near_shading_default",
  "policy_fallback",
] as const;

// ─── Entrées conceptuelles (pour futures implémentations) ─────────────────

export type CanonicalHeightPointInput = {
  readonly kind: CanonicalHeightPointKind;
  readonly xPx: number;
  readonly yPx: number;
  /** Si connu — améliore fitPlane / P2. */
  readonly panId?: string;
  /** Hauteur explicite sur le point (m) si déjà portée par les données (h / heightM). */
  readonly explicitZM?: number;
};

export type CanonicalHeightResolutionContext = {
  readonly heightResolver: HeightResolverContext;
  readonly resolveOptions?: ResolveHeightOptions;
};

// ─── Sortie façade unique (future) ─────────────────────────────────────────

export type CanonicalPointZResolution = Pick<
  HeightResolutionResult,
  "heightM" | "source" | "confidence" | "warning" | "panId"
> & {
  /** true si z provient d’un fallback ou d’une confiance < seuil métier (à définir par appelant). */
  readonly isDegraded: boolean;
};

// ─── Garde-fous : sources interdites pour produire z bâtiment ─────────────

const FORBIDDEN_Z_SOURCES = new Set<string>([
  "heightPx",
  "widthPx",
  "tiltDeg_alone",
  "physical_slope_alone",
  "physical_orientation_alone",
  "houseModelV2_depth_axis_as_canonical_z",
  "obstaclesFar_height_as_roof_z",
  "sun_elevation_deg_as_building_height",
  "horizon_elevation_deg_as_building_height",
  "panel_module_heightM_as_altitude",
]);

export function isForbiddenCanonicalZSource(id: string): boolean {
  return FORBIDDEN_Z_SOURCES.has(id);
}

/**
 * true si une cote z « bâtiment » est inacceptable sans diagnostic (silence interdit).
 */
export function isSilentZeroBaseZProblem(params: {
  readonly z: number;
  readonly hadResolverContext: boolean;
  readonly markedDegraded: boolean;
}): boolean {
  return params.z === 0 && params.hadResolverContext === false && params.markedDegraded === false;
}

/**
 * Spécification : resolveCanonicalPointZ agrège les branches par kind.
 * Implémentation : à brancher sur resolveHeightAtXY / resolveZForPanCorner / adaptateurs.
 */
export type ResolveCanonicalPointZ = (
  input: CanonicalHeightPointInput,
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution;

// Variantes spécialisées (signatures cibles — implémentations futures)
export type ResolveBuildingContourPointZ = (
  input: Pick<CanonicalHeightPointInput, "xPx" | "yPx" | "explicitZM" | "panId">,
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution;

export type ResolvePanVertexZ = (
  input: Pick<CanonicalHeightPointInput, "xPx" | "yPx" | "explicitZM" | "panId">,
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution;

export type ResolveStructuralLineEndpointZ = (
  input: Pick<CanonicalHeightPointInput, "xPx" | "yPx" | "explicitZM" | "panId">,
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution;

export type ResolveObstacleBaseZ = (
  input: { readonly xPx: number; readonly yPx: number; readonly panId?: string },
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution;

export type ResolveObstacleTopZ = (
  input: { readonly xPx: number; readonly yPx: number; readonly panId?: string; readonly relativeHeightM: number },
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution & { readonly baseZM: number; readonly topZM: number };

export type ResolveRoofExtensionBaseZ = ResolveObstacleBaseZ;
export type ResolveRoofExtensionTopZ = (
  input: { readonly xPx: number; readonly yPx: number; readonly panId?: string; readonly ridgeHeightRelM: number },
  context: CanonicalHeightResolutionContext,
) => CanonicalPointZResolution & { readonly baseZM: number; readonly topZM: number };
