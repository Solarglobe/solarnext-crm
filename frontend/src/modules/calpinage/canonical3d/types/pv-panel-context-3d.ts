/**
 * Contexte géométrique local des panneaux PV (bords de pan, lignes structurantes, volumes).
 * Couche additive — pas de collision / shading runtime ici.
 */

import type { PlaneFrameUv2D } from "./coordinates";
import type { RoofEdgeSemanticKind } from "./edge";
import type { StableEntityId } from "./primitives";

/** Classe de marge par rapport au bord du pan (seuils métier indicatifs, m). */
export type PvPanelEdgeClearanceClass =
  | "comfortable"
  | "moderate"
  | "tight"
  | "critical"
  | "unknown";

/** Qualité globale du contexte spatial disponible pour ce panneau. */
export type PvPanelSpatialContextQuality = "complete" | "partial" | "missing";

/** Qualité d’ancrage géométrique sur le pan (audit sans shading). */
export type PvPanelGeometricAnchorQuality = "strong" | "moderate" | "weak" | "unknown";

/**
 * Panneau vs bord du patch porteur (polygone bord projeté en UV tangents).
 */
export interface PvPanelPatchBoundaryContext3D {
  /** Polygone bord du pan en (u,v) — même ordre que `RoofPlanePatch3D.cornersWorld`. */
  readonly patchBoundaryPolygonUv: readonly PlaneFrameUv2D[];
  /** Quad panneau en (u,v). */
  readonly panelQuadUv: readonly PlaneFrameUv2D[];
  readonly centerInsidePatchBoundary: boolean;
  readonly cornersAllInsidePatchBoundary: boolean;
  /** Distance minimale (m) d’un échantillon du panneau au bord du pan ; null si indéterminé. */
  readonly minDistanceToPatchBoundaryM: number | null;
  /** Max des distances min coin → bord (m) — « profondeur » locale du quad dans le pan. */
  readonly maxCornerMinDistanceToPatchBoundaryM: number | null;
  /** Indice d’arête du bord du pan la plus proche (0..n-1). */
  readonly nearestPatchBoundaryEdgeIndex: number | null;
  /** ID d’arête bord si `RoofPlanePatch3D.boundaryEdgeIds` aligné sur le même ordre. */
  readonly nearestPatchBoundaryEdgeId: StableEntityId | null;
  readonly edgeClearanceClass: PvPanelEdgeClearanceClass;
  readonly nearRoofBoundary: boolean;
}

/** Sémantique d’une ligne structurante pour le contexte panneau (superset métier). */
export type PvPanelStructuralSemantic =
  | RoofEdgeSemanticKind
  | "shared_inter_pan"
  | "break_line"
  | "unknown";

/**
 * Proximité aux segments structurants (ridges, ruptures, arêtes partagées).
 * Distances en 3D (m) — segment traité comme segment d’espace.
 */
export interface PvPanelStructuralProximity3D {
  readonly nearestStructuralLineId: StableEntityId | null;
  readonly nearestStructuralSemantic: PvPanelStructuralSemantic;
  /** Distance minimale (m) du panneau au segment le plus proche ; null si non évalué ; `Infinity` si liste vide ou aucun segment incident. */
  readonly minDistanceToStructuralLineM: number | null;
  readonly structuralSegmentsEvaluated: number;
  readonly nearRidgeOrHip: boolean;
  readonly nearRoofBreak: boolean;
  readonly nearSharedStructuralEdge: boolean;
}

/** Indication heuristique de conflit futur avec un volume (pas de collision exacte). */
export type PvPanelVolumeOverlapLikelihood = "none" | "low" | "moderate" | "unknown";

/**
 * Proximité aux volumes canoniques (obstacles / extensions).
 */
export interface PvPanelVolumeProximityContext3D {
  readonly nearestObstacleVolumeId: StableEntityId | null;
  readonly nearestObstacleDistanceM: number | null;
  readonly nearestExtensionVolumeId: StableEntityId | null;
  readonly nearestExtensionDistanceM: number | null;
  readonly overlapLikelihood: PvPanelVolumeOverlapLikelihood;
  /** Vrai si AABB panneau ∩ AABB volume non vide (heuristique grossière). */
  readonly footprintConflictHint: boolean;
}

/**
 * Regroupe le contexte spatial exploitable pour ombrage / diagnostics futurs.
 */
export interface PvPanelSpatialContext3D {
  readonly patchBoundary: PvPanelPatchBoundaryContext3D;
  readonly structuralLines: PvPanelStructuralProximity3D;
  readonly volumes: PvPanelVolumeProximityContext3D;
  readonly spatialContextQuality: PvPanelSpatialContextQuality;
  readonly geometricAnchorQuality: PvPanelGeometricAnchorQuality;
}
