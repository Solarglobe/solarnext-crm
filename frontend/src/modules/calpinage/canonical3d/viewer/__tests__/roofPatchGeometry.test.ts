import { describe, expect, it } from "vitest";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { roofPatchGeometry } from "../solarSceneThreeGeometry";

describe("roofPatchGeometry", () => {
  it("repli triangulation XY monde si le contour UV est non simple / échoue", () => {
    const normal = { x: 0, y: 0, z: 1 };
    const patch = {
      id: "bowtie-uv",
      topologyRole: "primary_shell",
      boundaryVertexIds: ["v0", "v1", "v2", "v3"],
      boundaryEdgeIds: ["e0", "e1", "e2", "e3"],
      cornersWorld: [
        { x: 0, y: 0, z: 10 },
        { x: 20, y: 0, z: 10 },
        { x: 20, y: 20, z: 10 },
        { x: 0, y: 20, z: 10 },
      ],
      polygon2DInPlane: [
        { u: 0, v: 0 },
        { u: 20, v: 20 },
        { u: 20, v: 0 },
        { u: 0, v: 20 },
      ],
      localFrame: {
        role: "roof_face",
        origin: { x: 0, y: 0, z: 10 },
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        zAxis: { ...normal },
      },
      normal,
      equation: { normal, d: -10 },
      boundaryCycleWinding: "unspecified",
      centroid: { x: 10, y: 10, z: 10 },
      surface: { areaM2: 400 },
      adjacentPlanePatchIds: [],
      provenance: { source: "solver", solverStep: "test:bowtie-uv" },
      quality: { confidence: "high", diagnostics: [] },
    } as RoofPlanePatch3D;

    const geo = roofPatchGeometry(patch);
    const idx = geo.getIndex();
    expect(idx).not.toBeNull();
    expect(idx!.array.length).toBe(6);
    geo.dispose();
  });
});
