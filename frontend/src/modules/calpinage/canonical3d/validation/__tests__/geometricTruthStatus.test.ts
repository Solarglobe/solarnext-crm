import { describe, expect, it } from "vitest";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { evaluateRoofPatchGeometryTruth } from "../geometricTruthStatus";

describe("geometricTruthStatus", () => {
  it("tolère un écart relatif minime entre surface polygone et triangles sur grand pan", () => {
    const patch: RoofPlanePatch3D = {
      id: "prod-like-pan",
      topologyRole: "primary_shell",
      boundaryVertexIds: ["v1", "v2", "v3", "v4"],
      boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
      cornersWorld: [
        { x: 22.252260966435294, y: -10.95303505627603, z: 5 },
        { x: 16.740966568925902, y: -10.414337107647292, z: 0 },
        { x: 15.59519426248784, y: -22.281264567184326, z: 0 },
        { x: 21.199273067638348, y: -22.882200698409942, z: 5 },
      ],
      localFrame: {
        role: "roof_face",
        origin: { x: 18.946923716371845, y: -16.632709357379397, z: 2.5 },
        xAxis: { x: -0.741612653614299, y: 0.0724728913886425, z: -0.6669020557870008 },
        yAxis: { x: -0.09492419950546387, y: -0.9954810511262553, z: -0.0026216782435935647 },
        zAxis: { x: -0.6640783600957079, y: 0.06136087403497495, z: 0.745140775149407 },
      },
      normal: { x: -0.6640783600957079, y: 0.06136087403497495, z: 0.745140775149407 },
      equation: {
        normal: { x: -0.6640783600957079, y: 0.06136087403497495, z: 0.745140775149407 },
        d: 11.73998767629168,
      },
      boundaryCycleWinding: "unspecified",
      centroid: { x: 18.946923716371845, y: -16.632709357379397, z: 2.5 },
      surface: { areaM2: 89.58434897043335 },
      adjacentPlanePatchIds: [],
      provenance: { source: "solver", solverStep: "prod-regression" },
      quality: { confidence: "medium", diagnostics: [] },
    };

    const truth = evaluateRoofPatchGeometryTruth(patch);

    expect(truth.triangulation.areaDeltaM2).toBeGreaterThan(0.001);
    expect(truth.status).toBe("VALID");
    expect(truth.diagnostics.some((d) => d.code === "TRIANGULATION_SURFACE_MISMATCH")).toBe(false);
  });
});
