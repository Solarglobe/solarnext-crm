/**
 * Solutions de plans toiture — sortie du solveur officiel `solveRoofPlanes`.
 * Repère local bâtiment (m). Aucune lecture runtime calpinage.
 *
 * @see docs/architecture/roof-plane-solver.md
 */

import type {
  BuildingLocalVec3,
  CanonicalHouseDocument,
  CanonicalHouseEntityId,
  HeightProvenance,
} from "./canonicalHouse3DModel";
import type { RoofTopologyGraph } from "./roofTopologyModel";

export const ROOF_PLANE_SOLUTION_SET_SCHEMA_ID = "roof-plane-solution-set-v1" as const;

/** Plan implicite unitaire : n·p + d = 0, |n| = 1, n_z > 0 (toit « vers le haut » local). */
export interface RoofPlaneEquation {
  readonly normal: BuildingLocalVec3;
  readonly d: number;
}

export type RoofPlaneResolutionMethod =
  | "least_squares_z_equals_ax_plus_by_plus_c_primary_heights"
  | "least_squares_with_secondary_provenance_heights"
  | "exact_three_non_collinear_points"
  | "unresolved_under_constrained"
  | "unresolved_conflicting_heights"
  | "unresolved_vertical_plane"
  | "skipped_topology_invalid";

export type RoofPlaneResolutionConfidence = "high" | "medium" | "low" | "none";

export interface HeightConstraintUsed {
  readonly vertexId: CanonicalHouseEntityId;
  readonly heightQuantityId: CanonicalHouseEntityId;
  readonly valueZM: number;
  readonly provenance: HeightProvenance;
  readonly constraintTier: "primary" | "secondary";
}

export interface TopologyConstraintRef {
  readonly topologyEdgeId?: CanonicalHouseEntityId;
  readonly officialKind?: string;
  readonly note: string;
}

export interface RoofPatchPlaneDiagnostics {
  readonly missingConstraints: readonly string[];
  readonly conflicts: readonly string[];
}

export interface RoofPatchPlaneSolution {
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly planeEquation: RoofPlaneEquation | null;
  readonly planeNormal: BuildingLocalVec3 | null;
  /** Coefficients explicites z = a*x + b*y + c lorsque résolu (redondant avec plan implicite). */
  readonly explicitZ: { readonly a: number; readonly b: number; readonly c: number } | null;
  /** Sommets contour canoniques avec Z posés sur le plan résolu (ou null si non résolu). */
  readonly solvedVertices3D: readonly BuildingLocalVec3[] | null;
  readonly supportConstraintsUsed: readonly HeightConstraintUsed[];
  readonly topologyHintsUsed: readonly TopologyConstraintRef[];
  readonly resolutionMethod: RoofPlaneResolutionMethod;
  readonly resolutionConfidence: RoofPlaneResolutionConfidence;
  readonly isFullyConstrained: boolean;
  readonly isFallbackUsed: boolean;
  readonly maxResidualM: number | null;
  readonly diagnostics: RoofPatchPlaneDiagnostics;
}

export interface RoofPlaneSolutionSetDiagnostics {
  readonly isValid: boolean;
  readonly patchCount: number;
  readonly solvedPatchCount: number;
  readonly fullyConstrainedPatchCount: number;
  readonly partialPatchCount: number;
  readonly fallbackPatchCount: number;
  readonly ambiguousPatchCount: number;
  readonly invalidPatchCount: number;
  readonly constraintConflictCount: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface RoofPlaneSolutionSet {
  readonly schemaId: typeof ROOF_PLANE_SOLUTION_SET_SCHEMA_ID;
  readonly solutions: readonly RoofPatchPlaneSolution[];
  readonly diagnostics: RoofPlaneSolutionSetDiagnostics;
}

export interface SolveRoofPlanesInput {
  readonly document: CanonicalHouseDocument;
  readonly topologyGraph: RoofTopologyGraph;
  /** Tolérance max |z_i - plan| sur points contraints (m). */
  readonly residualToleranceM?: number;
  /**
   * Si false, n’utilise que `user_input` et `business_rule` pour ajuster le plan.
   * Sinon, en secours explicite : `solver` / `fallback` / `reconstruction` avec `isFallbackUsed`.
   */
  readonly allowSecondaryHeightProvenance?: boolean;
}

export interface SolveRoofPlanesResult {
  readonly solutionSet: RoofPlaneSolutionSet;
}
