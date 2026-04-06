/**
 * Graphe topologique toit officiel — dérivé du `CanonicalHouseDocument` uniquement.
 * Pas de solveur de plan, pas de runtime calpinage.
 *
 * @see docs/architecture/roof-topology-graph.md
 */

import type { CanonicalHouseEntityId, RoofEdgeKind } from "./canonicalHouse3DModel";

export const ROOF_TOPOLOGY_GRAPH_SCHEMA_ID = "roof-topology-graph-v1" as const;

/**
 * Taxonomie officielle « graphe » (agrège `RoofEdgeKind` canonique : gable+rake → gable, etc.).
 */
export type RoofTopologyOfficialEdgeKind = "ridge" | "hip" | "valley" | "eave" | "gable" | "internal";

export type RoofPatchTopologyStatus = "ok" | "degenerate" | "boundary_open";

export type RoofTopologyBoundaryStatus = "shared" | "boundary";

export type TopologyBuildabilityLevel = "clean" | "partial" | "ambiguous" | "invalid";

export interface RoofTopologyGraphVertex {
  readonly topologyVertexId: CanonicalHouseEntityId;
  /** Sommets canoniques fusionnés (même XY quantifié). */
  readonly canonicalVertexIds: readonly CanonicalHouseEntityId[];
  readonly positionXY: Readonly<{ x: number; y: number }>;
  readonly incidentPatchIds: readonly CanonicalHouseEntityId[];
  readonly incidentTopologyEdgeIds: readonly CanonicalHouseEntityId[];
}

export interface RoofPatchNeighborRelation {
  readonly neighborPatchId: CanonicalHouseEntityId;
  readonly sharedTopologyEdgeId: CanonicalHouseEntityId;
  readonly relationKind: "adjacent_along_edge";
  readonly ambiguity: "none" | "kind_conflict_on_shared_edge";
}

export interface RoofPatchTopologyNode {
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly boundaryTopologyVertexIds: readonly CanonicalHouseEntityId[];
  readonly boundaryTopologyEdgeIds: readonly CanonicalHouseEntityId[];
  readonly footprintSignedAreaM2: number;
  readonly neighbors: readonly RoofPatchNeighborRelation[];
  readonly status: RoofPatchTopologyStatus;
}

export interface RoofTopologyGraphEdge {
  readonly topologyEdgeId: CanonicalHouseEntityId;
  readonly vertexTopologyIdA: CanonicalHouseEntityId;
  readonly vertexTopologyIdB: CanonicalHouseEntityId;
  readonly officialKind: RoofTopologyOfficialEdgeKind;
  /** Types canoniques sources avant fusion / priorité. */
  readonly sourceCanonicalKinds: readonly RoofEdgeKind[];
  readonly sourceCanonicalEdgeIds: readonly CanonicalHouseEntityId[];
  readonly lengthM: number;
  /** Arête issue du relevé (faîtage, trait) sans incidence sur contour d’un pan dans ce document. */
  readonly isFloatingStructural: boolean;
  readonly boundaryStatus: RoofTopologyBoundaryStatus;
  readonly incidentPatchIds: readonly CanonicalHouseEntityId[];
  /** Identifiant de règle documentée (`roof-topology-graph.md`). */
  readonly typingRuleId: string;
  readonly kindMergeAmbiguous: boolean;
}

export interface RoofTopologyStructuralConstraint {
  readonly constraintId: CanonicalHouseEntityId;
  readonly kind: "ridge_segment" | "trait_segment" | "roof_to_building";
  readonly topologyEdgeIds: readonly CanonicalHouseEntityId[];
  readonly roofPatchIds?: readonly CanonicalHouseEntityId[];
  readonly source2dTrace?: string;
}

export interface RoofTopologyGraphDiagnostics {
  readonly isValid: boolean;
  readonly topologyBuildabilityLevel: TopologyBuildabilityLevel;
  readonly roofPatchCount: number;
  readonly topologyVertexCount: number;
  readonly topologyEdgeCount: number;
  readonly sharedEdgeCount: number;
  readonly boundaryEdgeCount: number;
  readonly ambiguousEdgeCount: number;
  readonly isolatedPatchCount: number;
  readonly degeneratePatchCount: number;
  readonly neighborRelationCount: number;
  readonly orphanCanonicalEdgeCount: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface RoofTopologyGraph {
  readonly schemaId: typeof ROOF_TOPOLOGY_GRAPH_SCHEMA_ID;
  readonly roofId: CanonicalHouseEntityId;
  readonly vertices: readonly RoofTopologyGraphVertex[];
  readonly edges: readonly RoofTopologyGraphEdge[];
  readonly patches: readonly RoofPatchTopologyNode[];
  readonly structuralConstraints: readonly RoofTopologyStructuralConstraint[];
  readonly diagnostics: RoofTopologyGraphDiagnostics;
}

export interface BuildRoofTopologyGraphResult {
  readonly graph: RoofTopologyGraph;
}

/** Alias nom export `buildRoofTopology`. */
export type BuildRoofTopologyResult = BuildRoofTopologyGraphResult;
