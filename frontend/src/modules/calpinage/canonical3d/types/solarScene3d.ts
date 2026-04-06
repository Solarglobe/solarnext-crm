/**
 * Contrat de scène 3D unifié SolarNext — une seule agrégation pour calcul, futur rendu, export, replay.
 *
 * Ne duplique pas la géométrie : pointe vers les entités canoniques existantes (RoofModel3D, volumes, PvPanelSurface3D).
 */

import type { Vector3 } from "./primitives";
import type { RoofModel3D } from "./model";
import type { CanonicalWorldConfig } from "../world/worldConvention";
import type { RoofObstacleVolume3D } from "./roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "./roof-extension-volume";
import type { PvPanelSurface3D } from "./pv-panel-3d";
import type { NearShadingSeriesResult } from "./near-shading-3d";
import type { QualityBlock } from "./quality";
import type { Scene2DSourceTrace, Validate2DTo3DCoherenceResult } from "./scene2d3dCoherence";
import type { PanelVisualShading } from "./panelVisualShading";

/** Version du schéma d’export `SolarScene3D` (distinct du schéma `RoofModel3D`). */
export const SOLAR_SCENE_3D_SCHEMA_VERSION = "solar-scene-3d-v1" as const;

/**
 * Convention de lecture pour un futur moteur de rendu (Three.js, etc.) — documentation stable, pas de géométrie dupliquée.
 */
export const SOLAR_SCENE_RENDER_CONVENTIONS = {
  roof: {
    planes: "roofModel.roofPlanePatches[] : cornersWorld (polygone plan), normal + equation, localFrame pour UV",
    edges: "roofModel.roofEdges[] : segments WORLD résolus",
    ridges: "roofModel.roofRidges[] : polylignes structurantes",
  },
  volumes: {
    obstacles:
      "obstacleVolumes[] : maillage volumique (faces triangulées via cycles de sommets), AABB dans bounds",
    extensions: "extensionVolumes[] : même structure que obstacles",
  },
  panels: {
    quads: "pvPanels[].corners3D (quad planaire), outwardNormal, localFrame pour pose",
    samples: "pvPanels[].samplingGrid.cellCentersWorld — réutilisables pour ombre / heatmap",
    spatial: "pvPanels[].spatialContext — proximité obstacles / bords pour placement assisté",
    visualShading:
      "panelVisualShadingByPanelId — projection viewer depuis runtime shading.perPanel (aucun recalcul ombrage)",
  },
  shading: {
    raycast: "nearShadingSnapshot.seriesResult — par pas temporel, panelResults[].shadingRatio",
  },
} as const;

export type SolarSceneGenerator =
  | "buildSolarScene3D"
  | "import"
  | "replay"
  | "manual";

export interface SolarScene3DMetadata {
  readonly schemaVersion: typeof SOLAR_SCENE_3D_SCHEMA_VERSION;
  readonly createdAtIso: string;
  readonly generator: SolarSceneGenerator;
  /** Référence étude / snapshot produit (optionnel). */
  readonly studyRef?: string;
  /** Piste d’audit : chaîne canonical3d + intégration shading. */
  readonly integrationNotes?: string;
}

/**
 * Contexte solaire injectable pour replay / futur rendu dynamique (trajectoire, série d’échantillons).
 * Les directions sont **vers le soleil** (même convention que near shading 3D).
 */
export interface SolarSceneSolarContext3D {
  /** Directions unitaires monde (vers le soleil), une par instant d’échantillonnage. */
  readonly directionsTowardSunUnit: readonly Vector3[];
  readonly samplingKind: "annual" | "custom" | "single" | "unknown";
  readonly description?: string;
}

/**
 * Instantané de calcul near shading (référence vers le résultat complet — pas de second calcul).
 */
export interface SolarSceneShadingSnapshot3D {
  readonly engineId: "canonical_near_raycast_v1" | string;
  readonly seriesResult: NearShadingSeriesResult;
  /** Agrégat par panneau (id string) pour futur coloration / preuve — dérivé de seriesResult. */
  readonly panelShadingSummaryById: Readonly<Record<string, SolarScenePanelShadingSummary>>;
}

export interface SolarScenePanelShadingSummary {
  readonly meanShadedFraction: number;
  readonly minShadedFraction: number;
  readonly maxShadedFraction: number;
}

/**
 * Scène 3D produit — point d’entrée unique pour visualisation, export, placement, preuve client.
 */
export interface SolarScene3D {
  readonly metadata: SolarScene3DMetadata;
  /**
   * Repère monde officiel (ENU, Z-up, image locale) — pour viewer, debug, picking futur.
   * Présent quand la scène est assemblée depuis le pipeline calpinage / runtime.
   */
  readonly worldConfig?: CanonicalWorldConfig;
  /**
   * Trace légère du dessin 2D / ids métier source — pour fidélité produit (optionnel hors pipeline runtime).
   */
  readonly sourceTrace?: Scene2DSourceTrace;
  /** Toiture canonique : pans, arêtes, faîtages, sommets (vérité géométrique toiture). */
  readonly roofModel: RoofModel3D;
  readonly obstacleVolumes: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly pvPanels: readonly PvPanelSurface3D[];
  /**
   * Lecture shading par id panneau (runtime `shading.perPanel` → pas de recalcul).
   * Absent si aucune donnée injectée à l’assemblage.
   */
  readonly panelVisualShadingByPanelId?: Readonly<Record<string, PanelVisualShading>>;
  /** Qualité globale volumes (builder). */
  readonly volumesQuality: QualityBlock;
  readonly solarContext?: SolarSceneSolarContext3D;
  readonly nearShadingSnapshot?: SolarSceneShadingSnapshot3D;
  /**
   * Diagnostic de cohérence 2D → 3D (rempli par `buildSolarScene3D` après assemblage des données finales).
   * Lecture seule — aucune mutation des entités géométriques.
   */
  readonly coherence?: Validate2DTo3DCoherenceResult;
}
