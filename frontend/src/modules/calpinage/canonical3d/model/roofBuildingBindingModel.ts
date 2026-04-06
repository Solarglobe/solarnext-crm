/**
 * Liaison métier toiture ↔ bâtiment (ancrage logique des arêtes basses, rives, pignons, débords).
 * Consomme uniquement `BuildingShell3D`, `RoofTopologyGraph`, `RoofPlaneSolutionSet`, `RoofIntersectionSet`.
 *
 * @see docs/architecture/roof-building-binding.md
 */

import type { BuildingLocalVec3, CanonicalHouseEntityId } from "./canonicalHouse3DModel";
import type { TopologyBuildabilityLevel } from "./roofTopologyModel";

export const ROOF_BUILDING_BINDING_SCHEMA_ID = "roof-building-binding-v1" as const;

export type RoofBindingConsistencyLevel = TopologyBuildabilityLevel;

/** Classification d’une rive : bord de toit non porté par un pan voisin (arête `boundary` du graphe). */
export type RoofRidgeFreeEdgeClassification = "gable" | "free_edge";

export type RoofRidgeSupportStatus = "wall_supported" | "floating" | "ambiguous_support";

export type RoofOverhangIntentFlag = "none" | "likely_intentional" | "ambiguous" | "inconsistent_geometry";

export interface RoofBindingDiagnosticNote {
  readonly code: string;
  readonly message: string;
  readonly topologyEdgeId?: CanonicalHouseEntityId;
  readonly wallSegmentId?: string;
}

/** Segment 3D sur le haut de mur (Z = topZ), extrémités dans l’ordre des sommets du `topRing`. */
export type AlignedWallTopSegment3D = readonly [BuildingLocalVec3, BuildingLocalVec3];

/**
 * Binding d’une arête eave (gouttière) : doit correspondre au haut d’un mur du `BuildingShell3D`.
 */
export interface RoofEaveWallBinding {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  readonly attachedWallSegmentId: CanonicalHouseEntityId | null;
  /** Indice mur cohérent avec `wallFaces[segmentIndex]` lorsque présent. */
  readonly attachedWallSegmentIndex: number | null;
  /** Segment 3D du haut de mur aligné (ou null si aucun mur retenu). */
  readonly alignedSegment3D: AlignedWallTopSegment3D | null;
  readonly roofEdgeSegment3D: AlignedWallTopSegment3D | null;
  /** Moyenne arithmétique (z_roof_A + z_roof_B) / 2 − topZ (m). */
  readonly verticalOffsetM: number | null;
  readonly isSnappedToWallTop: boolean;
  /**
   * Distance horizontale maximale (m) des extrémités eave au segment mur retenu (plan XY).
   * Sert de preuve géométrique « segment ↔ segment ».
   */
  readonly xyMaxDistanceToWallSegmentM: number | null;
  /** max(0, projection extérieure) sur les échantillons (extrémités + milieu), selon normale sortante du mur. */
  readonly outwardOverhangM: number;
  readonly isConsistent: boolean;
  readonly diagnostics: readonly RoofBindingDiagnosticNote[];
}

/**
 * Rive libre : arête frontière sans pan voisin (`boundary`), hors eave / pignon typés.
 */
export interface RoofFreeRidgeBinding {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  readonly classification: "free_edge";
  readonly supportStatus: RoofRidgeSupportStatus;
  readonly attachedWallSegmentId: CanonicalHouseEntityId | null;
  readonly roofEdgeSegment3D: AlignedWallTopSegment3D | null;
  readonly diagnostics: readonly RoofBindingDiagnosticNote[];
}

/**
 * Pignon (gable) : fermeture murale attendue sur une arête frontière typée `gable`.
 */
export interface RoofGableWallBinding {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  readonly classification: "gable";
  readonly attachedWallSegmentId: CanonicalHouseEntityId | null;
  readonly attachedWallSegmentIndex: number | null;
  readonly alignedSegment3D: AlignedWallTopSegment3D | null;
  readonly roofEdgeSegment3D: AlignedWallTopSegment3D | null;
  /** min(z) le long de l’arête toit − topZ (m) : ancrage bas du pignon sur couronne mur. */
  readonly minZOffsetFromWallTopM: number | null;
  /** |z_A − z_B| sur l’arête (m). */
  readonly verticalSpanAlongEdgeM: number | null;
  readonly isWallClosureGeometricallyConsistent: boolean;
  readonly diagnostics: readonly RoofBindingDiagnosticNote[];
}

export interface RoofOverhangBinding {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  readonly context: "eave" | "gable" | "free_edge";
  readonly overhangDistanceM: number;
  readonly isIntentional: RoofOverhangIntentFlag;
  readonly isConsistent: boolean;
  readonly diagnostics: readonly RoofBindingDiagnosticNote[];
}

export interface RoofBindingStructuralProof {
  readonly eaveEdgeCount: number;
  readonly correctlyAttachedEaveCount: number;
  readonly floatingEaveCount: number;
  readonly gableEdgeCount: number;
  readonly freeRidgeEdgeCount: number;
  readonly overhangDetectionCount: number;
}

export interface RoofBindingIntersectionCrossCheck {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  readonly leftPatchId: CanonicalHouseEntityId;
  readonly rightPatchId: CanonicalHouseEntityId;
  readonly intersectionConsistent: boolean;
  readonly note: string;
}

export interface RoofBindingIntersectionCrossCheckSummary {
  readonly inconsistentSharedEdgeCount: number;
  readonly entries: readonly RoofBindingIntersectionCrossCheck[];
}

export interface RoofBuildingBindingDiagnostics {
  readonly isValid: boolean;
  readonly roofAttachedToBuilding: boolean;
  readonly attachedEdgeCount: number;
  readonly floatingEdgeCount: number;
  readonly misalignedEdgeCount: number;
  readonly unsupportedEdgeCount: number;
  readonly overhangCount: number;
  readonly gableEdgeCount: number;
  readonly bindingConsistencyLevel: RoofBindingConsistencyLevel;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly structuralProof: RoofBindingStructuralProof;
  readonly intersectionCrossCheckSummary: RoofBindingIntersectionCrossCheckSummary;
}

export interface RoofBuildingBindingResult {
  readonly schemaId: typeof ROOF_BUILDING_BINDING_SCHEMA_ID;
  readonly eaveBindings: readonly RoofEaveWallBinding[];
  readonly freeRidgeBindings: readonly RoofFreeRidgeBinding[];
  readonly gableBindings: readonly RoofGableWallBinding[];
  readonly overhangs: readonly RoofOverhangBinding[];
  readonly diagnostics: RoofBuildingBindingDiagnostics;
}

export interface BindRoofToBuildingInput {
  /**
   * Coque bâtiment : `bottomRing`, `topRing`, `wallFaces`, `baseZ`, `topZ`.
   * Seuls ces champs sont utilisés pour l’ancrage (haut de mur = `topZ`).
   */
  readonly shell: import("./buildingShell3DModel").BuildingShell3D;
  /** Graphe topologique officiel (arêtes typées, statut boundary / shared). */
  readonly topologyGraph: import("./roofTopologyModel").RoofTopologyGraph;
  /** Plans résolus par pan — Z toit aux sommets d’arête. */
  readonly solutionSet: import("./roofPlaneSolutionModel").RoofPlaneSolutionSet;
  /** Intersections pans voisins — contrôle transversal, aucune correction géométrique. */
  readonly intersectionSet: import("./roofIntersectionModel").RoofIntersectionSet;
  /** Tolérance |moyenne z eave − topZ| pour « collé au haut de mur » (m). Défaut 0,02. */
  readonly zSnapToleranceM?: number;
  /** Tolérance max point-arête XY pour rattacher une arête toit à un segment mur (m). Défaut 0,08. */
  readonly wallSegmentXYToleranceM?: number;
  /** Seuil au-delà duquel un débord extérieur est étiqueté `likely_intentional` (m). Défaut 0,05. */
  readonly intentionalOverhangThresholdM?: number;
  /** Écart minimal entre 1er et 2e mur candidat pour éviter `ambiguous_support` (m). Défaut 0,02. */
  readonly wallMatchAmbiguityEpsilonM?: number;
  /**
   * Si l’arête toit est quasi parallèle au mur, distance perpendiculaire max entre les deux droites (plan XY)
   * pour accepter le rattachement (débord hors façade). Défaut 1,5 m.
   */
  readonly wallParallelOffsetMaxM?: number;
}

export interface BindRoofToBuildingOutput {
  readonly binding: RoofBuildingBindingResult;
}
