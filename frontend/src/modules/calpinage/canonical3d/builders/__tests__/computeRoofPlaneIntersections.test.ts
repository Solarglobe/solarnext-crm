import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import type { RoofTopology } from "../../model/canonicalHouse3DModel";
import { intersectImplicitPlanes } from "../../model/roofIntersectionModel";
import { buildRoofTopology } from "../buildRoofTopology";
import { computeRoofPlaneIntersections } from "../computeRoofPlaneIntersections";
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

function pipeline(doc: CanonicalHouseDocument) {
  const graph = buildRoofTopology(doc).graph;
  const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
  const { intersectionSet } = computeRoofPlaneIntersections({ document: doc, topologyGraph: graph, solutionSet });
  return { graph, solutionSet, intersectionSet };
}

describe("computeRoofPlaneIntersections", () => {
  it("faîtage simple (fixture) : ligne x=10, z constant, pas de gap ni step", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-ridge-two-pans.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    const { intersectionSet, solutionSet } = pipeline(doc);
    expect(solutionSet.diagnostics.solvedPatchCount).toBe(2);
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam).toBeDefined();
    expect(seam.intersectionLine3D).not.toBeNull();
    expect(seam.sharedSegment3D).not.toBeNull();
    expect(seam.hasGap).toBe(false);
    expect(seam.hasStep).toBe(false);
    expect(seam.isConsistent).toBe(true);
    expect(seam.officialEdgeKind).toBe("ridge");
    const [p0, p1] = seam.sharedSegment3D!;
    expect(p0.x).toBeCloseTo(10, 3);
    expect(p1.x).toBeCloseTo(10, 3);
    expect(p0.z).toBeCloseTo(7, 3);
    expect(p1.z).toBeCloseTo(7, 3);
    for (const p of [p0, p1]) {
      const eqL = solutionSet.solutions.find((s) => s.roofPatchId === "pan-left")!.planeEquation!;
      const eqR = solutionSet.solutions.find((s) => s.roofPatchId === "pan-right")!.planeEquation!;
      const d1 = Math.abs(eqL.normal.x * p.x + eqL.normal.y * p.y + eqL.normal.z * p.z + eqL.d);
      const d2 = Math.abs(eqR.normal.x * p.x + eqR.normal.y * p.y + eqR.normal.z * p.z + eqR.d);
      expect(d1).toBeLessThan(1e-2);
      expect(d2).toBeLessThan(1e-2);
    }
  });

  it("noue (fixture valley) : intersection cohérente sur l’arête partagée", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-valley-two-pans.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    const { intersectionSet } = pipeline(doc);
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam.officialEdgeKind).toBe("valley");
    expect(seam.isConsistent).toBe(true);
    expect(seam.hasStep).toBe(false);
    expect(seam.segmentStart3D!.z).toBeCloseTo(5, 2);
    expect(seam.segmentEnd3D!.z).toBeCloseTo(5, 2);
  });

  it("arêtier / hip : type topologique conservé, géométrie résolue", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-ridge-two-pans.json"), "utf-8");
    const doc = JSON.parse(raw) as CanonicalHouseDocument;
    const topo = { ...doc.roof.topology };
    const edges = topo.edges.map((e) =>
      e.edgeId.includes("ridge") ? { ...e, kind: "hip" as const } : e,
    );
    const docHip: CanonicalHouseDocument = { ...doc, roof: { ...doc.roof, topology: { ...topo, edges } } };
    const { intersectionSet } = pipeline(docHip);
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam.officialEdgeKind).toBe("hip");
    expect(seam.isConsistent).toBe(true);
  });

  it("raccord oblique : arête non alignée aux axes, segment sur la droite d’intersection", () => {
    const topo: RoofTopology = {
      roofId: "r-obl",
      vertices: [
        { vertexId: "a1", positionXY: { x: 0, y: 0 }, heightQuantityId: "h5" },
        { vertexId: "b1", positionXY: { x: 10, y: 5 }, heightQuantityId: "h7" },
        { vertexId: "c1", positionXY: { x: 10, y: 12 }, heightQuantityId: "h7" },
        { vertexId: "d1", positionXY: { x: 0, y: 8 }, heightQuantityId: "h5" },
        { vertexId: "b2", positionXY: { x: 10, y: 5 }, heightQuantityId: "h7" },
        { vertexId: "e2", positionXY: { x: 20, y: 2 }, heightQuantityId: "h5" },
        { vertexId: "f2", positionXY: { x: 20, y: 14 }, heightQuantityId: "h5" },
        { vertexId: "c2", positionXY: { x: 10, y: 12 }, heightQuantityId: "h7" },
      ],
      edges: [
        { edgeId: "o0", vertexIdA: "a1", vertexIdB: "b1", kind: "unknown_structural" },
        { edgeId: "o1", vertexIdA: "b1", vertexIdB: "c1", kind: "internal_structural" },
        { edgeId: "o2", vertexIdA: "c1", vertexIdB: "d1", kind: "unknown_structural" },
        { edgeId: "o3", vertexIdA: "d1", vertexIdB: "a1", kind: "unknown_structural" },
        { edgeId: "p0", vertexIdA: "b2", vertexIdB: "e2", kind: "unknown_structural" },
        { edgeId: "p1", vertexIdA: "e2", vertexIdB: "f2", kind: "unknown_structural" },
        { edgeId: "p2", vertexIdA: "f2", vertexIdB: "c2", kind: "unknown_structural" },
        { edgeId: "p3", vertexIdA: "c2", vertexIdB: "b2", kind: "internal_structural" },
      ],
      patches: [
        { roofPatchId: "p1", boundaryVertexIds: ["a1", "b1", "c1", "d1"], boundaryEdgeIds: ["o0", "o1", "o2", "o3"] },
        { roofPatchId: "p2", boundaryVertexIds: ["b2", "e2", "f2", "c2"], boundaryEdgeIds: ["p0", "p1", "p2", "p3"] },
      ],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: { buildingId: "b", buildingFootprint: [], buildingOuterContour: [], baseZ: 0 },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "h5", role: "custom", valueM: 5, provenance: "user_input", derivationRuleId: "t" },
        { id: "h7", role: "custom", valueM: 7, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const { intersectionSet, solutionSet } = pipeline(doc);
    const seam = intersectionSet.intersections.find((x) => x.leftPatchId === "p1" && x.rightPatchId === "p2")!;
    expect(seam.isConsistent).toBe(true);
    const eq1 = solutionSet.solutions.find((s) => s.roofPatchId === "p1")!.planeEquation!;
    const dir = seam.intersectionLine3D!.directionUnit;
    for (const t of [-2, 0, 2]) {
      const p = {
        x: seam.intersectionLine3D!.anchorPoint.x + t * dir.x,
        y: seam.intersectionLine3D!.anchorPoint.y + t * dir.y,
        z: seam.intersectionLine3D!.anchorPoint.z + t * dir.z,
      };
      const d = Math.abs(eq1.normal.x * p.x + eq1.normal.y * p.y + eq1.normal.z * p.z + eq1.d);
      expect(d).toBeLessThan(1e-2);
    }
  });

  it("pans non symétriques : pentes différentes, raccord valide sur l’arête", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-ridge-two-pans.json"), "utf-8");
    const doc0 = JSON.parse(raw) as CanonicalHouseDocument;
    const topo = {
      ...doc0.roof.topology,
      vertices: doc0.roof.topology.vertices.map((v) =>
        v.vertexId === "v20" || v.vertexId === "v2010"
          ? { ...v, heightQuantityId: "hLowRight" as const }
          : v,
      ),
    };
    const doc: CanonicalHouseDocument = {
      ...doc0,
      roof: { ...doc0.roof, topology: topo },
      heightModel: {
        ...doc0.heightModel,
        quantities: [
          ...doc0.heightModel.quantities,
          {
            id: "hLowRight",
            role: "custom" as const,
            valueM: 4,
            provenance: "user_input" as const,
            derivationRuleId: "t",
          },
        ],
      },
    };
    const { intersectionSet } = pipeline(doc);
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam.isConsistent).toBe(true);
    expect(seam.hasStep).toBe(false);
  });

  it("plans quasi confondus : coincident → overlap diagnostiqué", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-ridge-two-pans.json"), "utf-8");
    const doc0 = JSON.parse(raw) as CanonicalHouseDocument;
    const topo = {
      ...doc0.roof.topology,
      vertices: doc0.roof.topology.vertices.map((v) => ({ ...v, heightQuantityId: "hFlat" as const })),
    };
    const doc: CanonicalHouseDocument = {
      ...doc0,
      roof: { ...doc0.roof, topology: topo },
      heightModel: {
        ...doc0.heightModel,
        quantities: [{ id: "hFlat", role: "custom" as const, valueM: 5, provenance: "user_input" as const, derivationRuleId: "t" }],
      },
    };
    const { intersectionSet } = pipeline(doc);
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam.resolutionMethod).toBe("unresolved_coincident_planes");
    expect(seam.hasOverlap).toBe(true);
    expect(seam.intersectionLine3D).toBeNull();
  });

  it("plans parallèles : pas de droite, diagnostic parallel", () => {
    const topo: RoofTopology = {
      roofId: "r-par",
      vertices: [
        { vertexId: "a1", positionXY: { x: 0, y: 0 }, heightQuantityId: "z5" },
        { vertexId: "b1", positionXY: { x: 10, y: 0 }, heightQuantityId: "z7" },
        { vertexId: "c1", positionXY: { x: 10, y: 10 }, heightQuantityId: "z7" },
        { vertexId: "d1", positionXY: { x: 0, y: 10 }, heightQuantityId: "z5" },
        { vertexId: "a2", positionXY: { x: 10, y: 0 }, heightQuantityId: "z8" },
        { vertexId: "e2", positionXY: { x: 20, y: 0 }, heightQuantityId: "z10" },
        { vertexId: "f2", positionXY: { x: 20, y: 10 }, heightQuantityId: "z10" },
        { vertexId: "c2", positionXY: { x: 10, y: 10 }, heightQuantityId: "z8" },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a1", vertexIdB: "b1", kind: "unknown_structural" },
        { edgeId: "e1", vertexIdA: "b1", vertexIdB: "c1", kind: "unknown_structural" },
        { edgeId: "e2", vertexIdA: "c1", vertexIdB: "d1", kind: "unknown_structural" },
        { edgeId: "e3", vertexIdA: "d1", vertexIdB: "a1", kind: "unknown_structural" },
        { edgeId: "f0", vertexIdA: "a2", vertexIdB: "e2", kind: "unknown_structural" },
        { edgeId: "f1", vertexIdA: "e2", vertexIdB: "f2", kind: "unknown_structural" },
        { edgeId: "f2", vertexIdA: "f2", vertexIdB: "c2", kind: "unknown_structural" },
        { edgeId: "f3", vertexIdA: "c2", vertexIdB: "a2", kind: "unknown_structural" },
      ],
      patches: [
        { roofPatchId: "pl", boundaryVertexIds: ["a1", "b1", "c1", "d1"], boundaryEdgeIds: ["e0", "e1", "e2", "e3"] },
        { roofPatchId: "pr", boundaryVertexIds: ["a2", "e2", "f2", "c2"], boundaryEdgeIds: ["f0", "f1", "f2", "f3"] },
      ],
      roofToBuildingBindings: [],
    };
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: { buildingId: "b", buildingFootprint: [], buildingOuterContour: [], baseZ: 0 },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: baseHeightModel([
        { id: "z5", role: "custom", valueM: 5, provenance: "user_input", derivationRuleId: "t" },
        { id: "z7", role: "custom", valueM: 7, provenance: "user_input", derivationRuleId: "t" },
        { id: "z8", role: "custom", valueM: 8, provenance: "user_input", derivationRuleId: "t" },
        { id: "z10", role: "custom", valueM: 10, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [],
    };
    const { intersectionSet } = pipeline(doc);
    const seam = intersectionSet.intersections.find((x) => x.leftPatchId === "pl" && x.rightPatchId === "pr")!;
    expect(seam.resolutionMethod).toBe("unresolved_parallel_planes");
    expect(seam.intersectionLine3D).toBeNull();
    expect(seam.isConsistent).toBe(false);
    expect(intersectionSet.diagnostics.parallelPlaneCount).toBeGreaterThanOrEqual(1);
  });

  it("voisins topologiques mais marche Z volontaire : hasStep", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-ridge-two-pans.json"), "utf-8");
    const doc0 = JSON.parse(raw) as CanonicalHouseDocument;
    const topo = {
      ...doc0.roof.topology,
      vertices: doc0.roof.topology.vertices.map((v) =>
        v.vertexId === "v10b" || v.vertexId === "v1010b"
          ? { ...v, heightQuantityId: "hHighRidge" as const }
          : v,
      ),
    };
    const doc: CanonicalHouseDocument = {
      ...doc0,
      roof: { ...doc0.roof, topology: topo },
      heightModel: {
        ...doc0.heightModel,
        quantities: [
          ...doc0.heightModel.quantities,
          {
            id: "hHighRidge",
            role: "custom" as const,
            valueM: 8,
            provenance: "user_input" as const,
            derivationRuleId: "t",
          },
        ],
      },
    };
    const { intersectionSet } = pipeline(doc);
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam.hasStep).toBe(true);
    expect(seam.isConsistent).toBe(false);
    expect(seam.stepDistanceM).toBeGreaterThan(0.02);
  });

  it("tolérance step stricte : raccord accepté si marche inférieure au seuil", () => {
    const raw = readFileSync(join(__dirname, "../dev/roof-intersection-ridge-two-pans.json"), "utf-8");
    const doc0 = JSON.parse(raw) as CanonicalHouseDocument;
    const topo = {
      ...doc0.roof.topology,
      vertices: doc0.roof.topology.vertices.map((v) =>
        v.vertexId === "v10b" || v.vertexId === "v1010b"
          ? { ...v, heightQuantityId: "hRidgeTiny" as const }
          : v,
      ),
    };
    const doc: CanonicalHouseDocument = {
      ...doc0,
      roof: { ...doc0.roof, topology: topo },
      heightModel: {
        ...doc0.heightModel,
        quantities: [
          ...doc0.heightModel.quantities,
          {
            id: "hRidgeTiny",
            role: "custom" as const,
            valueM: 7.015,
            provenance: "user_input" as const,
            derivationRuleId: "t",
          },
        ],
      },
    };
    const graph = buildRoofTopology(doc).graph;
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
    const { intersectionSet } = computeRoofPlaneIntersections({
      document: doc,
      topologyGraph: graph,
      solutionSet,
      stepToleranceM: 0.05,
    });
    const seam = intersectionSet.intersections.find(
      (x) => x.leftPatchId === "pan-left" && x.rightPatchId === "pan-right",
    )!;
    expect(seam.hasStep).toBe(false);
  });

  it("intersectImplicitPlanes : deux plans sécants (preuve math)", () => {
    const n1 = { x: -0.2, y: 0, z: 1 };
    const l1 = Math.hypot(n1.x, n1.z);
    const eq1 = { normal: { x: n1.x / l1, y: 0, z: n1.z / l1 }, d: (-5 * n1.z) / l1 };
    const n2 = { x: 0.2, y: 0, z: 1 };
    const l2 = Math.hypot(n2.x, n2.z);
    const eq2 = { normal: { x: n2.x / l2, y: 0, z: n2.z / l2 }, d: (-9 * n2.z) / l2 };
    const r = intersectImplicitPlanes(eq1, eq2, 1e-8);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p = r.anchorPoint;
      expect(Math.abs(p.x - 10)).toBeLessThan(0.05);
      const e1 = Math.abs(eq1.normal.x * p.x + eq1.normal.y * p.y + eq1.normal.z * p.z + eq1.d);
      const e2 = Math.abs(eq2.normal.x * p.x + eq2.normal.y * p.y + eq2.normal.z * p.z + eq2.d);
      expect(e1).toBeLessThan(1e-4);
      expect(e2).toBeLessThan(1e-4);
    }
  });
});
