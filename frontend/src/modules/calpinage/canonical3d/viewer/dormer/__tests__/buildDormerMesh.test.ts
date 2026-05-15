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

  it("borne le sommet d'un chien assis dessiné avec arêtiers", () => {
    const patch = {
      id: "pan-test",
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
    } as unknown as RoofPlanePatch3D;

    const geo = buildDormerMesh(
      {
        kind: "dormer",
        type: "roof_extension",
        ridgeHeightRelM: 2.4,
        hips: {
          left: { a: { x: 10, y: 10 }, b: { x: 15, y: 15 } },
          right: { a: { x: 20, y: 10 }, b: { x: 15, y: 15 } },
        },
        ridge: { a: { x: 15, y: 15 }, b: { x: 16, y: 15 } },
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
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
    expect(maxZ).toBeLessThanOrEqual(6.051);
  });

  it("reste borné dans le contour dessiné, sans bounding box agrandie", () => {
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

    const contour = [
      { x: 10, y: 20 },
      { x: 15, y: 12 },
      { x: 22, y: 17 },
      { x: 20, y: 27 },
      { x: 9, y: 28 },
    ];
    const geo = buildDormerMesh(
      {
        kind: "dormer",
        type: "roof_extension",
        ridgeHeightRelM: 0.8,
        ridge: { a: { x: 14, y: 19 }, b: { x: 18, y: 21 } },
        contour: { closed: true, points: contour },
      },
      {
        world: { metersPerPixel: 1, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
        roofPlanePatches: [patch],
      },
    );

    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute("position") as THREE.BufferAttribute;
    const minX = Math.min(...contour.map((p) => p.x));
    const maxX = Math.max(...contour.map((p) => p.x));
    const minY = Math.min(...contour.map((p) => -p.y));
    const maxY = Math.max(...contour.map((p) => -p.y));
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i)).toBeGreaterThanOrEqual(minX - 1e-6);
      expect(pos.getX(i)).toBeLessThanOrEqual(maxX + 1e-6);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(minY - 1e-6);
      expect(pos.getY(i)).toBeLessThanOrEqual(maxY + 1e-6);
    }
  });
  it("consomme la geometrie canonique Phase 2 au lieu de reconstruire une boite", () => {
    const patch = {
      id: "pan-test",
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
    } as unknown as RoofPlanePatch3D;

    const geo = buildDormerMesh(
      {
        kind: "dormer",
        type: "roof_extension",
        visualModel: "manual_outline_gable",
        contour: {
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 22, y: 12 },
            { x: 20, y: 23 },
            { x: 12, y: 20 },
          ],
        },
        canonicalDormerGeometry: {
          vertices: [
            { id: "b0", x: 10, y: 10, h: 0 },
            { id: "b1", x: 22, y: 12, h: 0 },
            { id: "b2", x: 20, y: 23, h: 0 },
            { id: "b3", x: 12, y: 20, h: 0 },
            { id: "r0", x: 13, y: 16, h: 1.1 },
            { id: "r1", x: 19, y: 18, h: 1.1 },
          ],
          faces: [
            { id: "custom-roof-a", vertexIds: ["b0", "b1", "r1", "r0"] },
            { id: "custom-roof-b", vertexIds: ["b3", "r0", "r1", "b2"] },
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
    expect(pos.count).toBe(12);
    let hasManualSkewPoint = false;
    for (let i = 0; i < pos.count; i++) {
      hasManualSkewPoint ||= Math.abs(pos.getX(i) - 22) < 1e-6 && Math.abs(pos.getY(i) + 12) < 1e-6;
    }
    expect(hasManualSkewPoint).toBe(true);
  });

  it("ne reconstruit pas de boite automatique pour un chien assis manuel sans faitage", () => {
    const patch = {
      id: "pan-test",
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
    } as unknown as RoofPlanePatch3D;

    const geo = buildDormerMesh(
      {
        kind: "dormer",
        type: "roof_extension",
        visualModel: "manual_outline_gable",
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
    expect(geo).toBeNull();
  });
});
