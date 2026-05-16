/**
 * Catalogue métier unique — obstacles toiture (calpinage).
 * Les formes géométriques (rect / circle / polygon) restent internes au moteur.
 */

export type RoofObstacleCatalogCategory = "opaque_shading" | "non_shading_keepout";

/** Forme géométrique utilisée par le moteur / le legacy canvas. */
export type RoofObstacleGeometryShape = "rect" | "circle" | "polygon";

export type RoofObstacleBusinessId =
  | "chimney_square"
  | "chimney_round"
  | "vmc_round"
  | "antenna"
  | "roof_window"
  | "dormer_keepout"
  | "keepout_zone"
  | "generic_polygon_keepout"
  | "tree_shadow"
  | "parapet"
  | "roof_drain"
  | "legacy_shadow_cube"
  | "legacy_shadow_tube";

export interface RoofObstacleCatalogEntry {
  readonly id: RoofObstacleBusinessId;
  readonly label: string;
  readonly category: RoofObstacleCatalogCategory;
  /** true = obstacle physique ombrant (near shading + keepout pose PV). */
  readonly isShadingObstacle: boolean;
  readonly geometryShape: RoofObstacleGeometryShape;
  readonly defaultWidthM: number | null;
  readonly defaultDepthM: number | null;
  readonly defaultDiameterM: number | null;
  /** Hauteur physique au-dessus du plan toiture (m). null si non pertinent (keepout). */
  readonly defaultHeightM: number | null;
  readonly description?: string;
  readonly iconKey: string;
}

export const ROOF_OBSTACLE_CATALOG: Record<RoofObstacleBusinessId, RoofObstacleCatalogEntry> = {
  chimney_square: {
    id: "chimney_square",
    label: "Cheminée carrée",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "rect",
    defaultWidthM: 0.6,
    defaultDepthM: 0.6,
    defaultDiameterM: null,
    defaultHeightM: 1.8,
    description: "Prisme rectangulaire — ombrage opaque.",
    iconKey: "cube",
  },
  chimney_round: {
    id: "chimney_round",
    label: "Cheminée ronde",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.35,
    defaultHeightM: 2.0,
    description: "Volume cylindrique — ombrage opaque.",
    iconKey: "tube",
  },
  vmc_round: {
    id: "vmc_round",
    label: "VMC",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.25,
    defaultHeightM: 0.3,
    description: "Sortie VMC — ombrage opaque.",
    iconKey: "tube",
  },
  antenna: {
    id: "antenna",
    label: "Antenne",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.35,
    defaultHeightM: 1.5,
    description: "Antenne — simplification cylindrique.",
    iconKey: "tube",
  },
  roof_window: {
    id: "roof_window",
    label: "Velux",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "rect",
    defaultWidthM: 0.78,
    defaultDepthM: 0.98,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Fenêtre de toit — zone non posable uniquement.",
    iconKey: "rect",
  },
  dormer_keepout: {
    id: "dormer_keepout",
    label: "Lucarne",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "rect",
    defaultWidthM: 1.2,
    defaultDepthM: 1.0,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Lucarne — zone non posable uniquement.",
    iconKey: "rect",
  },
  keepout_zone: {
    id: "keepout_zone",
    label: "Zone non posable",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "rect",
    defaultWidthM: 1.0,
    defaultDepthM: 1.0,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Surface interdite au posage PV.",
    iconKey: "rect",
  },
  generic_polygon_keepout: {
    id: "generic_polygon_keepout",
    label: "Zone libre",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "polygon",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Contour libre — zone non posable.",
    iconKey: "polygon",
  },
  /** Fallback affichage / compat pour anciens volumes ombrants shape=cube sans meta métier. */
  tree_shadow: {
    id: "tree_shadow",
    label: "Arbre / ombre",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 2.5,
    defaultHeightM: 4.0,
    description: "Volume proxy pour ombrage d'arbre ou ombre distante.",
    iconKey: "tree",
  },
  parapet: {
    id: "parapet",
    label: "Acrotere",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "rect",
    defaultWidthM: 2.0,
    defaultDepthM: 0.25,
    defaultDiameterM: null,
    defaultHeightM: 0.45,
    description: "Acrotere ou releve de toiture - ombrage opaque.",
    iconKey: "rect",
  },
  roof_drain: {
    id: "roof_drain",
    label: "Evacuation",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.18,
    defaultHeightM: 0.12,
    description: "Evacuation toiture - petit obstacle technique.",
    iconKey: "tube",
  },
  legacy_shadow_cube: {
    id: "legacy_shadow_cube",
    label: "Volume ombrant (ancien)",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "rect",
    defaultWidthM: 0.6,
    defaultDepthM: 0.6,
    defaultDiameterM: null,
    defaultHeightM: 1.0,
    description: "Compatibilité données historiques.",
    iconKey: "cube",
  },
  /** Fallback pour anciens volumes shape=tube sans meta métier. */
  legacy_shadow_tube: {
    id: "legacy_shadow_tube",
    label: "Volume ombrant cylindrique (ancien)",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.6,
    defaultHeightM: 1.0,
    description: "Compatibilité données historiques.",
    iconKey: "tube",
  },
};

export function getRoofObstacleCatalogEntry(
  id: string | null | undefined
): RoofObstacleCatalogEntry | null {
  if (!id || typeof id !== "string") return null;
  return ROOF_OBSTACLE_CATALOG[id as RoofObstacleBusinessId] ?? null;
}

/** Hauteur near-shading pour obstacles 2D legacy (avant distinction métier explicite). */
export const LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M = 1;

/** Hauteur near-shading / 3D par défaut pour volumes ombrants sans hauteur explicite. */
export const LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M = 1;
