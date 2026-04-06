/**
 * Near shading 3D canonique : rayons vers le soleil, intersections maillages volumiques, agrégations.
 * Couche additive — non branchée au shading runtime CRM.
 *
 * Contrat geometry → shading & dégradation : docs/architecture/canonical-pipeline.md (sections 3.B, 7).
 */

import type { WorldPosition3D } from "./coordinates";
import type { GeometryDiagnostic } from "./quality";
import type { QualityBlock } from "./quality";
import type { StableEntityId, Vector3 } from "./primitives";
import type { PvPanelSurface3D } from "./pv-panel-3d";
import type { RoofExtensionVolume3D } from "./roof-extension-volume";
import type { RoofObstacleVolume3D } from "./roof-obstacle-volume";

/** Direction solaire unitaire monde : du point d’échantillonnage vers le soleil. */
export interface NearShadingSolarDirectionInput {
  readonly directionTowardSunWorld: Vector3;
}

/** Alias de contrat d’entrée rayon / soleil (spec Prompt 6). */
export type NearShadingRayInput = NearShadingSolarDirectionInput;

/** Paramètres numériques du raycast (tolérances, bornes). */
export interface NearShadingRaycastParams {
  /** Offset le long du rayon depuis la surface pour éviter l’auto-intersection (m). */
  readonly originEpsilonM: number;
  /** Longueur max du rayon (m) ; au-delà, considéré comme ciel libre. */
  readonly rayMaxLengthM: number;
  /** Préfiltrage AABB avant tests triangles (recommandé). */
  readonly useAabbBroadPhase: boolean;
}

/** Scène minimale pour un calcul near shading (références aux entités canoniques 3D). */
export interface NearShadingSceneContext {
  readonly panels: readonly PvPanelSurface3D[];
  readonly obstacleVolumes: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly params: NearShadingRaycastParams;
}

export type NearShadingOccluderKind = "obstacle" | "extension";

/** Résultat par point d’échantillonnage (grille panneau). */
export interface NearShadingSampleResult {
  readonly panelId: StableEntityId;
  readonly sampleIndex: number;
  readonly originWorld: WorldPosition3D;
  readonly shaded: boolean;
  /** Distance le long du rayon jusqu’au premier hit bloquant (m) ; null si non ombré. */
  readonly hitDistanceM: number | null;
  readonly hitVolumeId: StableEntityId | null;
  readonly hitVolumeKind: NearShadingOccluderKind | null;
  readonly hitFaceId: StableEntityId | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

/** Agrégation pour un panneau. */
export interface NearShadingPanelResult {
  readonly panelId: StableEntityId;
  readonly sampleResults: readonly NearShadingSampleResult[];
  readonly shadedSampleCount: number;
  readonly totalSampleCount: number;
  /** Fraction d’échantillons ombrés ∈ [0,1]. */
  readonly shadingRatio: number;
  readonly quality: QualityBlock;
}

/** Un pas temporel / une direction solaire. */
export interface NearShadingTimeStepResult {
  readonly solarDirection: NearShadingSolarDirectionInput;
  readonly panelResults: readonly NearShadingPanelResult[];
  readonly totalSamples: number;
  readonly shadedSamples: number;
  /** Fraction globale pondérée par le nombre d’échantillons. */
  readonly globalShadedFraction: number;
  readonly quality: QualityBlock;
}

/** Agrégation sur plusieurs directions / instants. */
export interface NearShadingAnnualAggregate {
  readonly timestepResults: readonly NearShadingTimeStepResult[];
  readonly meanShadedFraction: number;
  readonly minShadedFraction: number;
  readonly maxShadedFraction: number;
  /** Proxy simple de perte d’irradiance locale : 1 − moyenne des fractions ombrées. */
  readonly nearShadingLossProxy: number;
  readonly quality: QualityBlock;
}

/** Résultat complet d’une série temporelle + agrégat annuel. */
export interface NearShadingSeriesResult {
  readonly annual: NearShadingAnnualAggregate;
  readonly globalDiagnostics: readonly GeometryDiagnostic[];
}

/** Alias spec « build result » multi-pas + agrégat. */
export type NearShadingBuildResult = NearShadingSeriesResult;
