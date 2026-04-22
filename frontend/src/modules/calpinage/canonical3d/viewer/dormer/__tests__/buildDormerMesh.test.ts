import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RoofPlanePatch3D } from "../../../types/roof-surface";
import { buildDormerMesh } from "../buildDormerMesh";

describe("buildDormerMesh", () => {
  it("retourne une géométrie non vide pour un pignon minimal (plan toit horizontal)", () => {
    const patch = {
      id: "pan-test",
      topologyRole: "primary_shell",
      boundaryVertexIds: ["a", "b", "c", "d"],
      boundaryEdgeIds: ["e0", "e1", "e2", "e3"],
      cornersWorld: [
        { x: 0, y: 0, z: 5 },
        { x: 30, y: 0, z: 5 },
        { x: 30, y: -30, z: 5 },
        { x: 0, y: -30, z: 5 },
      ],
      localFrame: {
        origin: { x: 0, y: 0, z: 5 },
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        zAxis: { x: 0, y: 0, z: 1 },
      },
      normal: { x: 0, y: 0, z: 1 },
      equation: { normal: { x: 0, y: 0, z: 1 }, d: -5 },
      boundaryCycleWinding: "unspecified",
      centroid: { x: 15, y: -15, z: 5 },
      surface: { areaM2: 900, perimeterM: 120 },
      adjacentPlanePatchIds: [],
      provenance: { source: "test" },
      quality: { confidence: "high", diagnostics: [] },
    } as unknown as RoofPlanePatch3D;

    const geo = buildDormerMesh(
      {
        kind: "dormer",
        type: "roof_extension",
        ridgeHeightRelM: 1.2,
        ridge: { a: { x: 12, y: 18 }, b: { x: 18, y: 18 } },
        contour: {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
        },
      },
      {
        world: { metersPerPixel: 1, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
        roofPlanePatches: [patch],
      },
    );
    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute("position") as THREE.BufferAttribute;
    expect(pos.count).toBeGreaterThan(6);
  });

  it("retourne null si type explicite non dormer", () => {
    const geo = buildDormerMesh(
      { type: "shed", kind: "dormer", ridgeHeightRelM: 1, ridge: { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, contour: { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }] } },
      { world: { metersPerPixel: 1, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" }, roofPlanePatches: [] },
    );
    expect(geo).toBeNull();
  });
});
