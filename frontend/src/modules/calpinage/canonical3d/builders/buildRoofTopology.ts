/**
 * Builder officiel — graphe topologique toiture à partir du canonique House3D.
 * Ne relit pas CALPINAGE_STATE ; ne résout pas les plans 3D des pans.
 *
 * @see docs/architecture/roof-topology-graph.md
 */

import type { CanonicalHouseDocument, RoofEdgeKind, RoofTopologyEdge } from "../model/canonicalHouse3DModel";
import type {
  BuildRoofTopologyGraphResult,
  RoofPatchNeighborRelation,
  RoofPatchTopologyNode,
  RoofTopologyGraph,
  RoofTopologyGraphDiagnostics,
  RoofTopologyGraphEdge,
  RoofTopologyGraphVertex,
  RoofTopologyOfficialEdgeKind,
  RoofTopologyStructuralConstraint,
  TopologyBuildabilityLevel,
} from "../model/roofTopologyModel";
import { ROOF_TOPOLOGY_GRAPH_SCHEMA_ID } from "../model/roofTopologyModel";

const Q = 1_000_000;
const EPS_AREA = 1e-8;

function qKey(p: Readonly<{ x: number; y: number }>): string {
  return `${Math.round(p.x * Q)},${Math.round(p.y * Q)}`;
}

function edgeKeyUndirected(a: string, b: string): string {
  return a < b ? `${a}~~${b}` : `${b}~~${a}`;
}

/** @see docs/architecture/roof-topology-graph.md */
export function canonicalEdgeKindToOfficial(kind: RoofEdgeKind): RoofTopologyOfficialEdgeKind {
  switch (kind) {
    case "ridge":
      return "ridge";
    case "hip":
      return "hip";
    case "valley":
      return "valley";
    case "eave":
      return "eave";
    case "gable":
    case "rake":
      return "gable";
    case "internal_structural":
    case "unknown_structural":
    case "wall_plate":
      return "internal";
    case "contour_perimeter":
      return "eave";
    default:
      return "internal";
  }
}

function mergePrecedence(kind: RoofEdgeKind): number {
  switch (kind) {
    case "ridge":
      return 100;
    case "valley":
      return 95;
    case "hip":
      return 90;
    case "internal_structural":
      return 80;
    case "eave":
      return 70;
    case "gable":
    case "rake":
      return 65;
    case "wall_plate":
      return 55;
    case "unknown_structural":
      return 40;
    case "contour_perimeter":
      return 50;
    default:
      return 30;
  }
}

function pickOfficialFromSources(kinds: readonly RoofEdgeKind[]): {
  official: RoofTopologyOfficialEdgeKind;
  ambiguous: boolean;
} {
  const officials = new Set(kinds.map(canonicalEdgeKindToOfficial));
  let best: RoofEdgeKind = kinds[0]!;
  let bestP = mergePrecedence(best);
  for (const k of kinds) {
    const p = mergePrecedence(k);
    if (p > bestP) {
      best = k;
      bestP = p;
    }
  }
  const official = canonicalEdgeKindToOfficial(best);
  const ambiguous = officials.size > 1;
  return { official, ambiguous };
}

function signedAreaRing(xy: ReadonlyArray<Readonly<{ x: number; y: number }>>): number {
  let a = 0;
  const n = xy.length;
  for (let i = 0; i < n; i++) {
    const p = xy[i]!;
    const q = xy[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function dist2(a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isFloatingStructuralSource(kind: RoofEdgeKind): boolean {
  return kind === "ridge" || kind === "internal_structural" || kind === "valley" || kind === "hip";
}

type PatchDraft = Omit<RoofPatchTopologyNode, "neighbors">;

/**
 * Construit le graphe topologique officiel toiture (alias demandé prompt 4).
 */
export function buildRoofTopology(document: CanonicalHouseDocument): BuildRoofTopologyGraphResult {
  return buildRoofTopologyGraph(document);
}

export function buildRoofTopologyGraph(document: CanonicalHouseDocument): BuildRoofTopologyGraphResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const topo = document.roof.topology;
  const roofId = topo.roofId;

  const vById = new Map<string, { vertexId: string; positionXY: { x: number; y: number } }>();
  for (const v of topo.vertices) {
    vById.set(v.vertexId, { vertexId: v.vertexId, positionXY: { x: v.positionXY.x, y: v.positionXY.y } });
  }

  const clusterKeyToCanonIds = new Map<string, string[]>();
  for (const v of topo.vertices) {
    const k = qKey(v.positionXY);
    if (!clusterKeyToCanonIds.has(k)) clusterKeyToCanonIds.set(k, []);
    clusterKeyToCanonIds.get(k)!.push(v.vertexId);
  }

  const canonToTopology = new Map<string, string>();
  for (const ids of clusterKeyToCanonIds.values()) {
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    const rep = sorted[0]!;
    const topologyVertexId = `tv-${rep}`;
    for (const id of sorted) {
      canonToTopology.set(id, topologyVertexId);
    }
    if (sorted.length > 1) {
      warnings.push(`VERTEX_CLUSTER_MERGE:${topologyVertexId}:${sorted.join(",")}`);
    }
  }

  type EdgeAgg = { readonly sources: RoofTopologyEdge[] };
  const edgeAgg = new Map<string, EdgeAgg>();

  for (const e of topo.edges) {
    const ta = canonToTopology.get(e.vertexIdA);
    const tb = canonToTopology.get(e.vertexIdB);
    if (!ta || !tb) {
      errors.push(`EDGE_ENDPOINT_UNKNOWN_VERTEX:${e.edgeId}`);
      continue;
    }
    if (ta === tb) {
      warnings.push(`DEGENERATE_CANONICAL_EDGE_COLLAPSED:${e.edgeId}`);
      continue;
    }
    const ek = edgeKeyUndirected(ta, tb);
    if (!edgeAgg.has(ek)) edgeAgg.set(ek, { sources: [] });
    edgeAgg.get(ek)!.sources.push(e);
  }

  const topologyEdgeIdByKey = new Map<string, string>();
  let teCounter = 0;
  for (const k of edgeAgg.keys()) {
    topologyEdgeIdByKey.set(k, `te-${teCounter++}`);
  }

  const patchBoundaryEdgeKeys = new Map<string, Set<string>>();
  for (const p of topo.patches) {
    patchBoundaryEdgeKeys.set(p.roofPatchId, new Set());
  }

  const patchDrafts: PatchDraft[] = [];

  for (const p of topo.patches) {
    const n = p.boundaryVertexIds.length;
    const tvIds: string[] = [];
    for (const vid of p.boundaryVertexIds) {
      const tv = canonToTopology.get(vid);
      if (!tv) {
        errors.push(`PATCH_VERTEX_UNKNOWN:${p.roofPatchId}:${vid}`);
      } else {
        tvIds.push(tv);
      }
    }
    if (tvIds.length !== n) {
      patchDrafts.push({
        roofPatchId: p.roofPatchId,
        boundaryTopologyVertexIds: tvIds,
        boundaryTopologyEdgeIds: [],
        footprintSignedAreaM2: 0,
        status: "boundary_open",
      });
      continue;
    }

    const positions = p.boundaryVertexIds.map((vid) => {
      const vx = vById.get(vid);
      return vx ? vx.positionXY : { x: NaN, y: NaN };
    });
    const area = signedAreaRing(positions);
    let status: RoofPatchTopologyNode["status"] = "ok";
    const uniqueTv = new Set(tvIds);
    if (uniqueTv.size < 3 || Math.abs(area) < EPS_AREA) {
      status = "degenerate";
      errors.push(`PATCH_DEGENERATE:${p.roofPatchId}`);
    }

    const boundaryTe: string[] = [];
    const pEdgeSet = patchBoundaryEdgeKeys.get(p.roofPatchId)!;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = tvIds[i]!;
      const b = tvIds[j]!;
      const ek = edgeKeyUndirected(a, b);
      const teId = topologyEdgeIdByKey.get(ek);
      if (!teId) {
        errors.push(`PATCH_BOUNDARY_MISSING_UNIFIED_EDGE:${p.roofPatchId}:${i}`);
        status = "boundary_open";
      } else {
        boundaryTe.push(teId);
        pEdgeSet.add(ek);
      }
      const canonEid = p.boundaryEdgeIds[i];
      if (canonEid != null) {
        const canonE = topo.edges.find((x) => x.edgeId === canonEid);
        if (canonE) {
          const cta = canonToTopology.get(canonE.vertexIdA);
          const ctb = canonToTopology.get(canonE.vertexIdB);
          const expected = cta && ctb ? edgeKeyUndirected(cta, ctb) : null;
          if (expected && expected !== ek) {
            warnings.push(`PATCH_BOUNDARY_EDGE_MISMATCH:${p.roofPatchId}:${canonEid}`);
          }
        }
      }
    }

    patchDrafts.push({
      roofPatchId: p.roofPatchId,
      boundaryTopologyVertexIds: tvIds,
      boundaryTopologyEdgeIds: boundaryTe,
      footprintSignedAreaM2: area,
      status,
    });
  }

  const edgeIncidentPatches = new Map<string, Set<string>>();
  for (const ek of edgeAgg.keys()) {
    edgeIncidentPatches.set(topologyEdgeIdByKey.get(ek)!, new Set());
  }
  for (const p of topo.patches) {
    const set = patchBoundaryEdgeKeys.get(p.roofPatchId);
    if (!set) continue;
    for (const ek of set) {
      const teId = topologyEdgeIdByKey.get(ek);
      if (teId) edgeIncidentPatches.get(teId)!.add(p.roofPatchId);
    }
  }

  const graphEdges: RoofTopologyGraphEdge[] = [];
  for (const [ek, agg] of edgeAgg) {
    const teId = topologyEdgeIdByKey.get(ek)!;
    const [ta, tb] = ek.split("~~") as [string, string];
    const kinds = agg.sources.map((s) => s.kind);
    const { official, ambiguous } = pickOfficialFromSources(kinds);
    const repA = topo.vertices.find((v) => canonToTopology.get(v.vertexId) === ta);
    const repB = topo.vertices.find((v) => canonToTopology.get(v.vertexId) === tb);
    const lengthM = repA && repB ? dist2(repA.positionXY, repB.positionXY) : 0;

    const patchesHere = [...(edgeIncidentPatches.get(teId) ?? new Set())];
    const boundaryStatus = patchesHere.length >= 2 ? "shared" : "boundary";
    const hasStructuralSource = agg.sources.some((s) => isFloatingStructuralSource(s.kind));
    const onAnyPatch = patchesHere.length > 0;
    const isFloatingStructural = !onAnyPatch && hasStructuralSource;

    if (ambiguous) {
      warnings.push(`EDGE_KIND_MERGE_AMBIGUOUS:${teId}:${[...new Set(kinds)].join(",")}`);
    }

    graphEdges.push({
      topologyEdgeId: teId,
      vertexTopologyIdA: ta,
      vertexTopologyIdB: tb,
      officialKind: official,
      sourceCanonicalKinds: kinds,
      sourceCanonicalEdgeIds: agg.sources.map((s) => s.edgeId),
      lengthM,
      isFloatingStructural,
      boundaryStatus,
      incidentPatchIds: patchesHere,
      typingRuleId: "canonical-to-official-v1+merge-precedence-v1",
      kindMergeAmbiguous: ambiguous,
    });
  }

  const edgeById = new Map(graphEdges.map((e) => [e.topologyEdgeId, e] as const));

  function computeNeighbors(node: PatchDraft): RoofPatchNeighborRelation[] {
    if (node.status === "degenerate" || node.status === "boundary_open") return [];
    const neigh: RoofPatchNeighborRelation[] = [];
    for (const teId of node.boundaryTopologyEdgeIds) {
      const ge = edgeById.get(teId);
      if (!ge || ge.boundaryStatus !== "shared") continue;
      const others = ge.incidentPatchIds.filter((pid) => pid !== node.roofPatchId);
      for (const op of others) {
        neigh.push({
          neighborPatchId: op,
          sharedTopologyEdgeId: teId,
          relationKind: "adjacent_along_edge",
          ambiguity: ge.kindMergeAmbiguous ? "kind_conflict_on_shared_edge" : "none",
        });
      }
    }
    return neigh;
  }

  const patchesFinal: RoofPatchTopologyNode[] = patchDrafts.map((d) => ({
    ...d,
    neighbors: computeNeighbors(d),
  }));

  const vertexIncidentPatches = new Map<string, Set<string>>();
  const vertexIncidentEdges = new Map<string, Set<string>>();
  for (const v of graphEdges) {
    for (const vid of [v.vertexTopologyIdA, v.vertexTopologyIdB]) {
      if (!vertexIncidentEdges.has(vid)) vertexIncidentEdges.set(vid, new Set());
      vertexIncidentEdges.get(vid)!.add(v.topologyEdgeId);
    }
  }
  for (const pn of patchesFinal) {
    for (const tv of pn.boundaryTopologyVertexIds) {
      if (!vertexIncidentPatches.has(tv)) vertexIncidentPatches.set(tv, new Set());
      vertexIncidentPatches.get(tv)!.add(pn.roofPatchId);
    }
  }

  const graphVertices: RoofTopologyGraphVertex[] = [];
  for (const canonList of clusterKeyToCanonIds.values()) {
    const sorted = [...canonList].sort((a, b) => a.localeCompare(b));
    const topologyVertexId = `tv-${sorted[0]!}`;
    const anyV = topo.vertices.find((v) => canonList.includes(v.vertexId));
    if (!anyV) continue;
    graphVertices.push({
      topologyVertexId,
      canonicalVertexIds: sorted,
      positionXY: { x: anyV.positionXY.x, y: anyV.positionXY.y },
      incidentPatchIds: [...(vertexIncidentPatches.get(topologyVertexId) ?? new Set())].sort(),
      incidentTopologyEdgeIds: [...(vertexIncidentEdges.get(topologyVertexId) ?? new Set())].sort(),
    });
  }

  const structuralConstraints: RoofTopologyStructuralConstraint[] = [];
  let cIdx = 0;
  for (const e of graphEdges) {
    const hasRidge = e.sourceCanonicalKinds.includes("ridge");
    const hasTrait = e.sourceCanonicalKinds.includes("internal_structural");
    if (hasRidge) {
      structuralConstraints.push({
        constraintId: `sc-ridge-${cIdx++}`,
        kind: "ridge_segment",
        topologyEdgeIds: [e.topologyEdgeId],
        source2dTrace: topo.edges.find((x) => e.sourceCanonicalEdgeIds.includes(x.edgeId))?.source2dTrace,
      });
    }
    if (hasTrait && !hasRidge) {
      structuralConstraints.push({
        constraintId: `sc-trait-${cIdx++}`,
        kind: "trait_segment",
        topologyEdgeIds: [e.topologyEdgeId],
        source2dTrace: topo.edges.find((x) => e.sourceCanonicalEdgeIds.includes(x.edgeId))?.source2dTrace,
      });
    }
  }
  for (const b of topo.roofToBuildingBindings) {
    structuralConstraints.push({
      constraintId: `sc-bind-${b.roofPatchId}`,
      kind: "roof_to_building",
      topologyEdgeIds: [],
      roofPatchIds: [b.roofPatchId],
      source2dTrace: b.note,
    });
  }

  const roofPatchCount = patchesFinal.length;
  const degeneratePatchCount = patchesFinal.filter((p) => p.status === "degenerate").length;
  const sharedEdgeCount = graphEdges.filter((e) => e.boundaryStatus === "shared").length;
  const boundaryEdgeCount = graphEdges.filter((e) => e.boundaryStatus === "boundary").length;
  const ambiguousEdgeCount = graphEdges.filter((e) => e.kindMergeAmbiguous).length;
  const neighborRelationCount = patchesFinal.reduce((s, p) => s + p.neighbors.length, 0);
  const isolatedPatchCount =
    roofPatchCount > 1 ? patchesFinal.filter((p) => p.neighbors.length === 0 && p.status === "ok").length : 0;

  const canonicalEdgesOnUnified = new Set<string>();
  for (const e of graphEdges) {
    for (const id of e.sourceCanonicalEdgeIds) canonicalEdgesOnUnified.add(id);
  }
  const orphanCanonicalEdgeCount = topo.edges.filter((e) => !canonicalEdgesOnUnified.has(e.edgeId)).length;

  const isValid = errors.length === 0 && degeneratePatchCount === 0;
  let topologyBuildabilityLevel: TopologyBuildabilityLevel = "clean";
  if (!isValid) topologyBuildabilityLevel = "invalid";
  else if (ambiguousEdgeCount > 0) topologyBuildabilityLevel = "ambiguous";
  else if (warnings.length > 0) topologyBuildabilityLevel = "partial";

  const diagnostics: RoofTopologyGraphDiagnostics = {
    isValid,
    topologyBuildabilityLevel,
    roofPatchCount,
    topologyVertexCount: graphVertices.length,
    topologyEdgeCount: graphEdges.length,
    sharedEdgeCount,
    boundaryEdgeCount,
    ambiguousEdgeCount,
    isolatedPatchCount,
    degeneratePatchCount,
    neighborRelationCount,
    orphanCanonicalEdgeCount,
    errors,
    warnings,
  };

  const graph: RoofTopologyGraph = {
    schemaId: ROOF_TOPOLOGY_GRAPH_SCHEMA_ID,
    roofId,
    vertices: graphVertices,
    edges: graphEdges,
    patches: patchesFinal,
    structuralConstraints,
    diagnostics,
  };

  return { graph };
}
