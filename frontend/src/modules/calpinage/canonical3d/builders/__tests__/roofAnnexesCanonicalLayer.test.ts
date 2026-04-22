import { describe, expect, it } from "vitest";
import type {
  AnnexDiscriminated,
  CanonicalHouseDocument,
  RoofTopology,
} from "../../model/canonicalHouse3DModel";
import { buildRoofTopology } from "../buildRoofTopology";
import { solveRoofPlanes } from "../solveRoofPlanes";
import { evaluateZOnRoofPlane } from "../solveRoofPlanes";
import { buildCanonicalRoofAnnexesLayer3D } from "../buildCanonicalRoofAnnexesLayer3D";
import { regularNGonAroundCenter } from "../roofAnnexPolygon2d";
import { bindRoofAnnexesToRoofPatches } from "../bindRoofAnnexesToRoofPatches";

function hm(
  quantities: CanonicalHouseDocument["heightModel"]["quantities"],
): CanonicalHouseDocument["heightModel"] {
  return {
    quantities,
    zBase: {
      id: "hq-z-base",
      role: "z_base",
      valueM: 0,
      provenance: "business_rule",
      derivationRuleId: "test",
    },
    conventions: { basePlaneDescription: "test" },
  };
}

/** Carré 10×10 horizontal à z = zPlane (une hauteur primaire `hid`). */
function flatSquareRoofDoc(zPlane: number, annexes: AnnexDiscriminated[]): CanonicalHouseDocument {
  const hid = "h-flat";
  const topo: RoofTopology = {
    roofId: "roof-1",
    vertices: [
      { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: hid },
      { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: hid },
      { vertexId: "c", positionXY: { x: 10, y: 10 }, heightQuantityId: hid },
      { vertexId: "d", positionXY: { x: 0, y: 10 }, heightQuantityId: hid },
    ],
    edges: [
      { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "eave" },
      { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "eave" },
      { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "eave" },
      { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "eave" },
    ],
    patches: [
      {
        roofPatchId: "pan-main",
        boundaryVertexIds: ["a", "b", "c", "d"],
        boundaryEdgeIds: ["e0", "e1", "e2", "e3"],
      },
    ],
    roofToBuildingBindings: [],
  };
  return {
    schemaId: "canonical-house3d-model-v1",
    building: {
      buildingId: "b1",
      buildingFootprint: [],
      buildingOuterContour: [],
      baseZ: 0,
    },
    roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
    heightModel: hm([
      { id: hid, role: "custom", valueM: zPlane, provenance: "user_input", derivationRuleId: "t" },
    ]),
    annexes,
  };
}

function extrusionAnnex(
  id: string,
  family: AnnexDiscriminated["family"],
  footprint: { x: number; y: number }[],
  topZM: number,
): AnnexDiscriminated {
  return {
    annexId: id,
    family,
    attachedRoofPatchIds: [],
    dataStatus: "primary",
    geometry: {
      kind: "footprint_extrusion",
      footprint,
      zBottomId: "hq-z-base",
      zTopId: "hq-annex-top",
    },
  };
}

function runLayer(doc: CanonicalHouseDocument) {
  const graph = buildRoofTopology(doc).graph;
  const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
  return buildCanonicalRoofAnnexesLayer3D({ document: doc, topologyGraph: graph, solutionSet });
}

describe("roofAnnexes canonical layer (Prompt 8)", () => {
  it("obstacle rectangle centré : contenu, volume 8 sommets, base sur plan", () => {
    const footprint = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ];
    const doc = flatSquareRoofDoc(5.2, [
      extrusionAnnex("annex-1", "physical_roof_obstacle", footprint, 7.2),
    ]);
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 7.2,
      provenance: "user_input",
      sourceRef: "annex-1",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    const it0 = layer.items[0]!;
    expect(it0.bindingStatus).toBe("fully_contained_single_patch");
    expect(it0.roofPatchId).toBe("pan-main");
    expect(it0.geometryStatus).toBe("volume_ok");
    expect(it0.footprint3D?.length).toBe(8);
    expect(it0.baseReference?.method).toBe("roof_patch_plane_evaluation");
    const sol = solveRoofPlanes({
      document: doc,
      topologyGraph: buildRoofTopology(doc).graph,
    }).solutionSet.solutions.find((s) => s.roofPatchId === "pan-main")!;
    for (const p of it0.footprint3D!.slice(0, 4)) {
      expect(p.z).toBeCloseTo(evaluateZOnRoofPlane(sol.planeEquation!, p.x, p.y), 5);
    }
    expect(it0.sideFacesTriangleIndices?.length).toBe(8);
  });

  it("obstacle approximé par cercle (n-gon) sur pan simple", () => {
    const poly = regularNGonAroundCenter(5, 5, 1.2, 32);
    const doc = flatSquareRoofDoc(4, [
      extrusionAnnex("annex-circle", "physical_roof_obstacle", poly, 6),
    ]);
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 6,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    expect(layer.items[0]!.bindingStatus).toBe("fully_contained_single_patch");
    expect(layer.items[0]!.geometryStatus).toBe("volume_ok");
  });

  it("Velux / ouverture : footprint sur plan, cutCandidate, pas de volume extrudé", () => {
    const footprint = [
      { x: 3, y: 3 },
      { x: 5, y: 3 },
      { x: 5, y: 5 },
      { x: 3, y: 5 },
    ];
    const doc = flatSquareRoofDoc(5, [
      {
        annexId: "annex-velux",
        family: "future_opening",
        attachedRoofPatchIds: [],
        dataStatus: "primary",
        geometry: {
          kind: "footprint_extrusion",
          footprint,
          zBottomId: "hq-z-base",
          zTopId: "hq-z-base",
        },
      },
    ]);
    const layer = runLayer(doc);
    const it0 = layer.items[0]!;
    expect(it0.annexFamily).toBe("roof_opening");
    expect(it0.cutCandidate).toBe(true);
    expect(it0.geometryStatus).toBe("opening_footprint_only");
    expect(it0.sideFacesTriangleIndices).toBeNull();
    expect(it0.footprint3D?.length).toBe(4);
  });

  it("cheminée = obstacle solide avec hauteur", () => {
    const footprint = [
      { x: 8, y: 8 },
      { x: 9.2, y: 8 },
      { x: 9.2, y: 9.2 },
      { x: 8, y: 9.2 },
    ];
    const doc = flatSquareRoofDoc(5, [extrusionAnnex("chim", "physical_roof_obstacle", footprint, 8)]);
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 8,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    expect(layer.items[0]!.topologyCompatibility).toBe("compatible");
    expect(layer.items[0]!.geometryStatus).toBe("volume_ok");
  });

  it("obstacle proche rive : toujours contenu si dans le polygone", () => {
    const footprint = [
      { x: 0.2, y: 4 },
      { x: 1.2, y: 4 },
      { x: 1.2, y: 6 },
      { x: 0.2, y: 6 },
    ];
    const doc = flatSquareRoofDoc(5, [extrusionAnnex("near-eave", "physical_roof_obstacle", footprint, 6.5)]);
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 6.5,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    expect(layer.items[0]!.bindingStatus).toBe("fully_contained_single_patch");
  });

  it("obstacle partiellement hors pan : chevauchement partiel", () => {
    const footprint = [
      { x: 9, y: 4 },
      { x: 12, y: 4 },
      { x: 12, y: 6 },
      { x: 9, y: 6 },
    ];
    const doc = flatSquareRoofDoc(5, [extrusionAnnex("out", "physical_roof_obstacle", footprint, 6)]);
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 6,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    expect(layer.items[0]!.bindingStatus).toBe("partial_overlap_single_patch");
    expect(["crosses_patch_boundary", "partial_overlap"]).toContain(layer.items[0]!.topologyCompatibility);
  });

  it("deux pans : annexe à cheval → straddles ou needs_roof_split", () => {
    const hid = "h-flat";
    const topo: RoofTopology = {
      roofId: "roof-2",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: hid },
        { vertexId: "b", positionXY: { x: 5, y: 0 }, heightQuantityId: hid },
        { vertexId: "c", positionXY: { x: 5, y: 10 }, heightQuantityId: hid },
        { vertexId: "d", positionXY: { x: 0, y: 10 }, heightQuantityId: hid },
        { vertexId: "e", positionXY: { x: 10, y: 0 }, heightQuantityId: hid },
        { vertexId: "f", positionXY: { x: 10, y: 10 }, heightQuantityId: hid },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "eave" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "eave" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "eave" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "eave" },
        { edgeId: "e4", vertexIdA: "b", vertexIdB: "e", kind: "eave" },
        { edgeId: "e5", vertexIdA: "e", vertexIdB: "f", kind: "eave" },
        { edgeId: "e6", vertexIdA: "f", vertexIdB: "c", kind: "eave" },
      ],
      patches: [
        {
          roofPatchId: "pan-left",
          boundaryVertexIds: ["a", "b", "c", "d"],
          boundaryEdgeIds: ["e0", "e1", "e2", "e3"],
        },
        {
          roofPatchId: "pan-right",
          boundaryVertexIds: ["b", "e", "f", "c"],
          boundaryEdgeIds: ["e4", "e5", "e6", "e1"],
        },
      ],
      roofToBuildingBindings: [],
    };
    /** Asymétrique sur les deux pans (sinon aires égales → ambiguous_patch_choice). */
    const footprint = [
      { x: 4.5, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 6 },
      { x: 4.5, y: 6 },
    ];
    const doc: CanonicalHouseDocument = {
      schemaId: "canonical-house3d-model-v1",
      building: {
        buildingId: "b1",
        buildingFootprint: [],
        buildingOuterContour: [],
        baseZ: 0,
      },
      roof: { topology: topo, geometry: { roofPatches: [], roofEdges: [] } },
      heightModel: hm([{ id: hid, role: "custom", valueM: 5, provenance: "user_input", derivationRuleId: "t" }]),
      annexes: [extrusionAnnex("straddle", "physical_roof_obstacle", footprint, 7)],
    };
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 7,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    expect(layer.items[0]!.bindingStatus).toBe("straddles_multiple_patches");
    expect(layer.items[0]!.topologyCompatibility).toBe("needs_roof_split");
  });

  it("volume ombrant sur plan incliné : base suit le plan résolu", () => {
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
      heightModel: hm([
        { id: "h0", role: "custom", valueM: 6, provenance: "user_input", derivationRuleId: "t" },
        { id: "h1", role: "custom", valueM: 8, provenance: "user_input", derivationRuleId: "t" },
      ]),
      annexes: [
        extrusionAnnex("sv1", "shading_volume", [
          { x: 4, y: 3 },
          { x: 6, y: 3 },
          { x: 6, y: 5 },
          { x: 4, y: 5 },
        ], 9),
      ],
    };
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 9,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    const it0 = layer.items[0]!;
    expect(it0.annexFamily).toBe("roof_shadow_volume");
    expect(it0.geometryStatus).toBe("volume_ok");
    const graph = buildRoofTopology(doc).graph;
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
    const eq = solutionSet.solutions[0]!.planeEquation!;
    for (const p of it0.footprint3D!.slice(0, 4)) {
      expect(p.z).toBeCloseTo(evaluateZOnRoofPlane(eq, p.x, p.y), 4);
    }
  });

  it("lucarne / extension : intent needs_dedicated_topology_split", () => {
    const footprint = [
      { x: 4, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 7 },
      { x: 4, y: 7 },
    ];
    const doc = flatSquareRoofDoc(5, [extrusionAnnex("dorm", "roof_extension", footprint, 7.5)]);
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "custom",
      valueM: 7.5,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const layer = runLayer(doc);
    expect(layer.items[0]!.extensionTopologyIntent).toBe("needs_dedicated_topology_split");
  });

  it("acrotère : géométrie différée", () => {
    const doc = flatSquareRoofDoc(5, [
      {
        annexId: "acro",
        family: "future_parapet_acrotere",
        attachedRoofPatchIds: [],
        dataStatus: "future",
        geometry: { kind: "placeholder", note: "edge uplift" },
      },
    ]);
    const graph = buildRoofTopology(doc).graph;
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
    const { items } = bindRoofAnnexesToRoofPatches({ document: doc, topologyGraph: graph, solutionSet });
    expect(items[0]!.bindingStatus).toBe("no_footprint_geometry");
    const layer = buildCanonicalRoofAnnexesLayer3D({ document: doc, topologyGraph: graph, solutionSet });
    expect(layer.items[0]!.geometryStatus).toBe("edge_uplift_deferred");
  });

  it("invalides : placeholder sans emprise", () => {
    const doc = flatSquareRoofDoc(5, [
      {
        annexId: "bad",
        family: "physical_roof_obstacle",
        attachedRoofPatchIds: [],
        dataStatus: "optional",
        geometry: { kind: "placeholder", note: "x" },
      },
    ]);
    const layer = runLayer(doc);
    expect(layer.items[0]!.bindingStatus).toBe("no_footprint_geometry");
  });

  it("hauteur manquante : obstacle sans delta Z", () => {
    const footprint = [
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ];
    const doc = flatSquareRoofDoc(5, [
      {
        annexId: "no-h",
        family: "physical_roof_obstacle",
        attachedRoofPatchIds: [],
        dataStatus: "primary",
        geometry: {
          kind: "footprint_extrusion",
          footprint,
          zBottomId: "hq-z-base",
          zTopId: "hq-z-base",
        },
      },
    ]);
    const layer = runLayer(doc);
    expect(layer.items[0]!.geometryStatus).toBe("height_missing");
  });

  it("obstacle proche faîtage : détection croisement arête structurante flottante", () => {
    const hid = "hz";
    const topo: RoofTopology = {
      roofId: "r",
      vertices: [
        { vertexId: "a", positionXY: { x: 0, y: 0 }, heightQuantityId: hid },
        { vertexId: "b", positionXY: { x: 10, y: 0 }, heightQuantityId: hid },
        { vertexId: "c", positionXY: { x: 10, y: 10 }, heightQuantityId: hid },
        { vertexId: "d", positionXY: { x: 0, y: 10 }, heightQuantityId: hid },
      ],
      edges: [
        { edgeId: "e0", vertexIdA: "a", vertexIdB: "b", kind: "eave" },
        { edgeId: "e1", vertexIdA: "b", vertexIdB: "c", kind: "eave" },
        { edgeId: "e2", vertexIdA: "c", vertexIdB: "d", kind: "eave" },
        { edgeId: "e3", vertexIdA: "d", vertexIdB: "a", kind: "eave" },
        {
          edgeId: "ridge-1",
          vertexIdA: "a",
          vertexIdB: "c",
          kind: "ridge",
        },
      ],
      patches: [
        {
          roofPatchId: "pan-main",
          boundaryVertexIds: ["a", "b", "c", "d"],
          boundaryEdgeIds: ["e0", "e1", "e2", "e3"],
        },
      ],
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
      heightModel: hm([{ id: hid, role: "custom", valueM: 5, provenance: "user_input", derivationRuleId: "t" }]),
      annexes: [
        extrusionAnnex("ridge-cross", "physical_roof_obstacle", [
          { x: 2, y: 4 },
          { x: 8, y: 4 },
          { x: 8, y: 6 },
          { x: 2, y: 6 },
        ], 7),
      ],
    };
    doc.heightModel.quantities.push({
      id: "hq-annex-top",
      role: "z_obstacle_top",
      valueM: 7,
      provenance: "user_input",
      derivationRuleId: "test",
    });
    const graph = buildRoofTopology(doc).graph;
    const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
    const { items } = bindRoofAnnexesToRoofPatches({ document: doc, topologyGraph: graph, solutionSet });
    expect(items[0]!.topologyCompatibility).toBe("crosses_roof_edge");
  });
});
