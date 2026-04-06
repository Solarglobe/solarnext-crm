import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import type { RoofTopology } from "../../model/canonicalHouse3DModel";
import { buildRoofTopology } from "../buildRoofTopology";
import { evaluateZOnRoofPlane, solveRoofPlanes } from "../solveRoofPlanes";

const __dirname = dirname(fileURLToPath(import.meta.url));

function baseHeightModel(quantities: CanonicalHouseDocument["heightModel"]["quantities"]) {
  return {
    quantities,
    zBase: {
      id: "hq-z-base",
      role: "z_base" as const,
      valueM: 0,
      provenance: "business_rule" as const,
      derivationRuleId: "test",
    },
    conventions: { basePlaneDescription: "test" },
  };
}

function solve(doc: CanonicalHouseDocument) {
  const graph = buildRoofTopology(doc).graph;
  return solveRoofPlanes({ document: doc, topologyGraph: graph });
}

describe("solveRoofPlanes", () => {
  it("rectangle horizontal : z constant, normale ~Z, sommets sur le plan (fixture JSON)", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-plane-rectangle-flat.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    const { solutionSet } = solve(doc);
    expect(solutionSet.diagnostics.isValid).toBe(true);
    const sol = solutionSet.solutions.find((s) => s.roofPatchId === "pan-main")!;
    expect(sol.planeEquation).not.toBeNull();
    expect(sol.explicitZ!.a).toBeCloseTo(0, 5);
    expect(sol.explicitZ!.b).toBeCloseTo(0, 5);
    expect(sol.explicitZ!.c).toBeCloseTo(5.2, 5);
    expect(sol.planeNormal!.z).toBeGreaterThan(0.99);
    expect(sol.isFullyConstrained).toBe(true);
    expect(sol.isFallbackUsed).toBe(false);
    expect(sol.maxResidualM).toBeLessThan(1e-6);
    for (const p of sol.solvedVertices3D!) {
      expect(p.z).toBeCloseTo(5.2, 5);
      const ze = evaluateZOnRoofPlane(sol.planeEquation!, p.x, p.y);
      expect(ze).toBeCloseTo(p.z, 5);
    }
    expect(sol.topologyHintsUsed.some((h) => h.officialKind === "eave")).toBe(true);
  });

  it("triangle : plan incliné cohérent", () => {
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: "h0" },
        { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: "h0" },
        { vertexId: "c", positionXY: { x: 5, y: 8 }, heightQuantityId: "h1" },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [{ roofPatchId: "tri", boundaryVertexIds: ["a", "b", "c"], boundaryEdgeIds: ["e0", "e1", "e2"] }],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "h0", role: "custom", valueM: 6, provenance: "user_input", derivationRuleId: "t" },
        { id: "h1", role: "custom", valueM: 8, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const { solutionSet } = solve(doc);
    expect(solutionSet.diagnostics.solvedPatchCount).toBe(1);
    const sol = solutionSet.solutions[0]!;
    expect(sol.solvedVertices3D).not.toBeNull();
    for (const p of sol.solvedVertices3D!) {
      const ze = evaluateZOnRoofPlane(sol.planeEquation!, p.x, p.y);
      expect(ze).toBeCloseTo(p.z, 4);
    }
  });

  it("trapèze : résidu nul sur contraintes", () => {
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: "z" },
        { vertexId: "b", positionXY: { x: 8, y: 0 }, heightQuantityId: "z" },
        { vertexId: "c", positionXY: { x: 7, y: 5 }, heightQuantityId: "z" },
        { vertexId: "d", positionXY: { x: 1, y: 5 }, heightQuantityId: "z" },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "eave" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "eave" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [{ roofPatchId: "trap", boundaryVertexIds: ["a", "b", "c", "d"], boundaryEdgeIds: ["e0", "e1", "e2", "e3"] }],
      roofToBuildingBindings: [],
    };
    const z = 4.5;
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "z", role: "custom", valueM: z, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const { solutionSet } = solve(doc);
    expect(solutionSet.diagnostics.isValid).toBe(true);
    expect(solutionSet.solutions[0]!.maxResidualM).toBeLessThan(1e-9);
  });

  it("pan sous-contraint (<3 hauteurs primaires, secondary interdit) : non résolu", () => {
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: "h0" },
        { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: "h0" },
        { vertexId: "c", positionXY: { x: 10, y: 10 } },
        { vertexId: "d", positionXY: { x: 0, y: 10 } },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "unknown_structural" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [{ roofPatchId: "p", boundaryVertexIds: ["a", "b", "c", "d"], boundaryEdgeIds: ["e0", "e1", "e2", "e3"] }],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "h0", role: "custom", valueM: 3, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const graph = buildRoofTopology(doc).graph;
    const { solutionSet } = solveRoofPlanes({
      document: doc,
      topologyGraph: graph,
      allowSecondaryHeightProvenance: false,
    });
    const sol = solutionSet.solutions.find((s) => s.roofPatchId === "p")!;
    expect(sol.resolutionMethod).toBe("unresolved_under_constrained");
    expect(sol.solvedVertices3D).toBeNull();
  });

  it("hauteur secondaire avec allowSecondary : fallback explicite", () => {
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: "hp" },
        { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: "hp" },
        { vertexId: "c", positionXY: { x: 10, y: 10 }, heightQuantityId: "hs" },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [{ roofPatchId: "tri", boundaryVertexIds: ["a", "b", "c"], boundaryEdgeIds: ["e0", "e1", "e2"] }],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "hp", role: "custom", valueM: 2, provenance: "user_input", derivationRuleId: "t" },
        { id: "hs", role: "custom", valueM: 4, provenance: "solver", derivationRuleId: "legacy" },
      ]),
      annexes: [],
    };
    const graph = buildRoofTopology(doc).graph;
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph, allowSecondaryHeightProvenance: true });
    const sol = solutionSet.solutions[0]!;
    expect(sol.isFallbackUsed).toBe(true);
    expect(sol.resolutionMethod).toBe("least_squares_with_secondary_provenance_heights");
    expect(sol.solvedVertices3D).not.toBeNull();
  });

  it("hauteurs contradictoires : conflit, pas de sommets résolus", () => {
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: "z0" },
        { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: "z0" },
        { vertexId: "c", positionXY: { x: 10, y: 10 }, heightQuantityId: "z0" },
        { vertexId: "d", positionXY: { x: 0, y: 10 }, heightQuantityId: "z1" },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "unknown_structural" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [{ roofPatchId: "sq", boundaryVertexIds: ["a", "b", "c", "d"], boundaryEdgeIds: ["e0", "e1", "e2", "e3"] }],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "z0", role: "custom", valueM: 0, provenance: "user_input", derivationRuleId: "t" },
        { id: "z1", role: "custom", valueM: 3, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const { solutionSet } = solve(doc);
    expect(solutionSet.diagnostics.constraintConflictCount).toBeGreaterThanOrEqual(1);
    expect(solutionSet.diagnostics.isValid).toBe(false);
    const sol = solutionSet.solutions.find((s) => s.roofPatchId === "sq")!;
    expect(sol.resolutionMethod).toBe("unresolved_conflicting_heights");
    expect(sol.solvedVertices3D).toBeNull();
  });

  it("arête ridge sur le contour : topologyHints incluent ridge", () => {
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: "z" },
        { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: "z" },
        { vertexId: "c", positionXY: { x: 10, y: 10 }, heightQuantityId: "z" },
        { vertexId: "d", positionXY: { x: 0, y: 10 }, heightQuantityId: "z" },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "eave" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "ridge" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "unknown_structural" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "unknown_structural" },
      ],
      patches: [{ roofPatchId: "p", boundaryVertexIds: ["a", "b", "c", "d"], boundaryEdgeIds: ["e0", "e1", "e2", "e3"] }],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "z", role: "custom", valueM: 5, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const { solutionSet } = solve(doc);
    const sol = solutionSet.solutions.find((s) => s.roofPatchId === "p")!;
    expect(sol.supportConstraintsUsed.length).toBeGreaterThanOrEqual(3);
    expect(sol.topologyHintsUsed.some((h) => h.officialKind === "ridge")).toBe(true);
  });

  it("graphe pan non ok : skipped", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-plane-rectangle-flat.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    const graph = buildRoofTopology(doc).graph;
    const badGraph = {
      ...graph,
      patches: graph.patches.map((p) =>
        p.roofPatchId === "pan-main" ? { ...p, status: "degenerate" as const } : p,
      ),
    };
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: badGraph });
    const sol = solutionSet.solutions.find((s) => s.roofPatchId === "pan-main")!;
    expect(sol.resolutionMethod).toBe("skipped_topology_invalid");
  });
});
