import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import type { RoofTopology } from "../../model/canonicalHouse3DModel";
import { buildRoofTopology, buildRoofTopologyGraph, canonicalEdgeKindToOfficial } from "../buildRoofTopology";

const __dirname = dirname(fileURLToPath(import.meta.url));

function baseDoc(roofTopology: RoofTopology): CanonicalHouseDocument {
  return {
    schemaId: "canonical-house3d-model-v1",
    building: {
      buildingId: "b",
      buildingFootprint: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      buildingOuterContour: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      baseZ: 0,
    },
    roof: {
      topology: roofTopology,
      geometry: { roofPatches: [], roofEdges: [] },
    },
    heightModel: {
      quantities: [],
      zBase: {
        id: "z0",
        role: "z_base",
        valueM: 0,
        provenance: "business_rule",
        derivationRuleId: "test",
      },
      conventions: { basePlaneDescription: "test" },
    },
    annexes: [],
  };
}

function closedPatch(
  id: string,
  vids: string[],
  edgePrefix: string,
): { roofPatchId: string; boundaryVertexIds: string[]; boundaryEdgeIds: string[] } {
  const boundaryEdgeIds = vids.map((_, i) => `${edgePrefix}-${i}`);
  return { roofPatchId: id, boundaryVertexIds: vids, boundaryEdgeIds };
}

describe("canonicalEdgeKindToOfficial", () => {
  it("mappe rake et contour vers gable / eave attendus", () => {
    expect(canonicalEdgeKindToOfficial("rake")).toBe("gable");
    expect(canonicalEdgeKindToOfficial("contour_perimeter")).toBe("eave");
    expect(canonicalEdgeKindToOfficial("unknown_structural")).toBe("internal");
  });
});

describe("buildRoofTopology", () => {
  it("deux pans partagés : arête unique, voisinage explicite (fixture JSON)", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-topology-two-pans.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    const { graph } = buildRoofTopology(doc);
    expect(graph.diagnostics.isValid).toBe(true);
    expect(graph.diagnostics.roofPatchCount).toBe(2);
    expect(graph.diagnostics.topologyVertexCount).toBe(6);
    expect(graph.diagnostics.topologyEdgeCount).toBe(7);
    expect(graph.diagnostics.sharedEdgeCount).toBe(1);
    expect(graph.diagnostics.boundaryEdgeCount).toBe(6);
    expect(graph.diagnostics.neighborRelationCount).toBe(2);
    expect(graph.diagnostics.ambiguousEdgeCount).toBe(0);
    const shared = graph.edges.filter((e) => e.boundaryStatus === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]!.incidentPatchIds.sort()).toEqual(["pan-left", "pan-right"].sort());
    const pLeft = graph.patches.find((p) => p.roofPatchId === "pan-left")!;
    expect(pLeft.neighbors.map((n) => n.neighborPatchId)).toContain("pan-right");
  });

  it("triangle équivalent : 3 sommets, 3 arêtes, 1 pan", () => {
    const topo: RoofTopology = {
      roofId: "r-tri",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 4, y: 0 } },
        { vertexId: "c", positionXY: { x: 2, y: 3 } },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [closedPatch("tri", ["a", "b", "c"], "te")],
      roofToBuildingBindings: [{ roofPatchId: "tri", buildingId: "b", note: "t" }],
    };
    const { graph } = buildRoofTopologyGraph(baseDoc(topo));
    expect(graph.diagnostics.isValid).toBe(true);
    expect(graph.diagnostics.topologyEdgeCount).toBe(3);
    expect(graph.diagnostics.sharedEdgeCount).toBe(0);
    expect(graph.patches[0]!.boundaryTopologyVertexIds).toHaveLength(3);
  });

  it("trapèze : 4 sommets, aire non nulle", () => {
    const topo: RoofTopology = {
      roofId: "r-trap",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 6, y: 0 } },
        { vertexId: "c", positionXY: { x: 5, y: 4 } },
        { vertexId: "d", positionXY: { x: 1, y: 4 } },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "eave" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "eave" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [closedPatch("trap", ["a", "b", "c", "d"], "te")],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    expect(graph.diagnostics.isValid).toBe(true);
    expect(Math.abs(graph.patches[0]!.footprintSignedAreaM2)).toBeGreaterThan(1e-6);
    expect(graph.edges.every((e) => e.officialKind !== undefined)).toBe(true);
  });

  it("toit en L : 3 pans, 2 arêtes partagées, voisinages multiples", () => {
    const topo: RoofTopology = {
      roofId: "r-l",
      vertices: [
        { vertexId: "v00", positionXY: { x: 0, y: 0 } },
        { vertexId: "v10", positionXY: { x: 10, y: 0 } },
        { vertexId: "v105", positionXY: { x: 10, y: 5 } },
        { vertexId: "v05", positionXY: { x: 0, y: 5 } },
        { vertexId: "v20", positionXY: { x: 20, y: 0 } },
        { vertexId: "v205", positionXY: { x: 20, y: 5 } },
        { vertexId: "v015", positionXY: { x: 0, y: 15 } },
        { vertexId: "v1015", positionXY: { x: 10, y: 15 } },
      ],
      edges: [
        ...["e1-0", "e1-1", "e1-2", "e1-3"].map((id, i) => {
          const ring = ["v00", "v10", "v105", "v05"];
          const a = ring[i]!;
          const b = ring[(i + 1) % 4]!;
          return { edgeId: id, vertexIdA: a, vertexIdB: b, kind: "unknown_structural" as const };
        }),
        ...["e2-0", "e2-1", "e2-2", "e2-3"].map((id, i) => {
          const ring = ["v10", "v20", "v205", "v105"];
          const a = ring[i]!;
          const b = ring[(i + 1) % 4]!;
          return { edgeId: id, vertexIdA: a, vertexIdB: b, kind: "unknown_structural" as const };
        }),
        ...["e3-0", "e3-1", "e3-2", "e3-3"].map((id, i) => {
          const ring = ["v05", "v105", "v1015", "v015"];
          const a = ring[i]!;
          const b = ring[(i + 1) % 4]!;
          return { edgeId: id, vertexIdA: a, vertexIdB: b, kind: "unknown_structural" as const };
        }),
      ],
      patches: [
        closedPatch("p-bottom-left", ["v00", "v10", "v105", "v05"], "e1"),
        closedPatch("p-bottom-right", ["v10", "v20", "v205", "v105"], "e2"),
        closedPatch("p-top", ["v05", "v105", "v1015", "v015"], "e3"),
      ],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    expect(graph.diagnostics.isValid).toBe(true);
    expect(graph.diagnostics.roofPatchCount).toBe(3);
    expect(graph.diagnostics.sharedEdgeCount).toBe(2);
    expect(graph.diagnostics.neighborRelationCount).toBe(4);
    const mid = graph.patches.find((p) => p.roofPatchId === "p-bottom-left")!;
    expect(mid.neighbors.length).toBe(2);
  });

  it("toit en T : 4 pans connectés", () => {
    const topo: RoofTopology = {
      roofId: "r-t",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 2, y: 0 } },
        { vertexId: "c", positionXY: { x: 2, y: 2 } },
        { vertexId: "d", positionXY: { x: 0, y: 2 } },
        { vertexId: "e", positionXY: { x: 4, y: 0 } },
        { vertexId: "f", positionXY: { x: 4, y: 2 } },
        { vertexId: "g", positionXY: { x: 6, y: 0 } },
        { vertexId: "h", positionXY: { x: 6, y: 2 } },
        { vertexId: "i", positionXY: { x: 2, y: 6 } },
        { vertexId: "j", positionXY: { x: 4, y: 6 } },
      ],
      edges: [
        { edgeId: "p1-0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "p1-1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "p1-2", vertexIdA: "c", vertexIdB: "d", kind: "unknown_structural" },
        { edgeId: "p1-3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
        { edgeId: "p2-0", vertexIdA: "b", vertexIdB: "e", kind: "unknown_structural" },
        { edgeId: "p2-1", vertexIdA: "e", vertexIdB: "f", kind: "unknown_structural" },
        { edgeId: "p2-2", vertexIdA: "f", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "p2-3", vertexIdA: "c", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "p3-0", vertexIdA: "e", vertexIdB: "g", kind: "unknown_structural" },
        { edgeId: "p3-1", vertexIdA: "g", vertexIdB: "h", kind: "unknown_structural" },
        { edgeId: "p3-2", vertexIdA: "h", vertexIdB: "f", kind: "unknown_structural" },
        { edgeId: "p3-3", vertexIdA: "f", vertexIdB: "e", kind: "unknown_structural" },
        { edgeId: "p4-0", vertexIdA: "c", vertexIdB: "f", kind: "unknown_structural" },
        { edgeId: "p4-1", vertexIdA: "f", vertexIdB: "j", kind: "unknown_structural" },
        { edgeId: "p4-2", vertexIdA: "j", vertexIdB: "i", kind: "unknown_structural" },
        { edgeId: "p4-3", vertexIdA: "i", vertexIdB: "c", kind: "unknown_structural" },
      ],
      patches: [
        closedPatch("p-left", ["a", "b", "c", "d"], "p1"),
        closedPatch("p-mid", ["b", "e", "f", "c"], "p2"),
        closedPatch("p-right", ["e", "g", "h", "f"], "p3"),
        closedPatch("p-stem", ["c", "f", "j", "i"], "p4"),
      ],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    expect(graph.diagnostics.isValid).toBe(true);
    expect(graph.diagnostics.roofPatchCount).toBe(4);
    expect(graph.diagnostics.sharedEdgeCount).toBeGreaterThanOrEqual(3);
    expect(graph.diagnostics.neighborRelationCount).toBeGreaterThanOrEqual(6);
  });

  it("arête dupliquée ridge + unknown : ambiguïté diagnostiquée", () => {
    const topo: RoofTopology = {
      roofId: "r-amb",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 1, y: 0 } },
        { vertexId: "c", positionXY: { x: 1, y: 1 } },
        { vertexId: "d", positionXY: { x: 0, y: 1 } },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e0b", vertexIdA: "a", vertexIdB: "b", kind: "ridge" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "unknown_structural" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [closedPatch("sq", ["a", "b", "c", "d"], "te")],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    expect(graph.diagnostics.ambiguousEdgeCount).toBeGreaterThanOrEqual(1);
    expect(graph.diagnostics.topologyBuildabilityLevel).toBe("ambiguous");
    const amb = graph.edges.find((e) => e.sourceCanonicalEdgeIds.includes("e0b"));
    expect(amb?.kindMergeAmbiguous).toBe(true);
    expect(amb?.officialKind).toBe("ridge");
  });

  it("pan dégénéré colinéaire : invalide", () => {
    const topo: RoofTopology = {
      roofId: "r-bad",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 1, y: 0 } },
        { vertexId: "c", positionXY: { x: 2, y: 0 } },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [closedPatch("bad", ["a", "b", "c"], "te")],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    expect(graph.diagnostics.isValid).toBe(false);
    expect(graph.diagnostics.degeneratePatchCount).toBe(1);
  });

  it("faîtage flottant : isFloatingStructural", () => {
    const topo: RoofTopology = {
      roofId: "r-float",
      vertices: [
        { vertexId: "r1", positionXY: { x: 100, y: 100 } },
        { vertexId: "r2", positionXY: { x: 110, y: 100 } },
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 5, y: 0 } },
        { vertexId: "c", positionXY: { x: 5, y: 5 } },
        { vertexId: "d", positionXY: { x: 0, y: 5 } },
      ],
      edges: [
        { edgeId: "ridge-float", vertexIdA: "r1", vertexIdB: "r2", kind: "ridge", source2dTrace: "ridge" },
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "unknown_structural" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [closedPatch("solo", ["a", "b", "c", "d"], "te")],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    const floating = graph.edges.find((e) => e.isFloatingStructural);
    expect(floating).toBeDefined();
    expect(floating!.incidentPatchIds).toHaveLength(0);
  });

  it("croupe / noue / arêtier : kinds conservés via officialKind", () => {
    const topo: RoofTopology = {
      roofId: "r-kinds",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 } },
        { vertexId: "b", positionXY: { x: 4, y: 0 } },
        { vertexId: "c", positionXY: { x: 4, y: 3 } },
        { vertexId: "d", positionXY: { x: 0, y: 3 } },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "hip" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "valley" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "ridge" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "eave" },
      ],
      patches: [closedPatch("p", ["a", "b", "c", "d"], "te")],
      roofToBuildingBindings: [],
    };
    const { graph } = buildRoofTopology(baseDoc(topo));
    const byKind = Object.fromEntries(graph.edges.map((e) => [e.sourceCanonicalKinds[0], e.officialKind]));
    expect(byKind.hip).toBe("hip");
    expect(byKind.valley).toBe("valley");
    expect(byKind.ridge).toBe("ridge");
    expect(byKind.eave).toBe("eave");
  });

  it("buildRoofTopologyGraph === buildRoofTopology", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-topology-two-pans.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    expect(buildRoofTopologyGraph(doc).graph.schemaId).toBe(buildRoofTopology(doc).graph.schemaId);
  });
});
