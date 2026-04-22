import { describe, expect, it } from "vitest";
import {
  computeShellTopRingPlaneFitRmsM,
  extrudeShellUnderSlopedRoofWorld,
  SHELL_TOP_RING_MAX_PLANARITY_RMS_M,
  shellTopRingPlanarEnoughForXyCap,
} from "../extrudeShellUnderSlopedRoofWorld";

describe("extrudeShellUnderSlopedRoofWorld — Phase A5 chapeau supérieur", () => {
  it("anneau haut quasi plat : RMS ≤ seuil → faces kind top présentes", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const zTop = [2, 2, 2, 2];
    const top3d = ring.map((p, i) => ({ x: p.x, y: p.y, z: zTop[i]! }));

    const rms = computeShellTopRingPlaneFitRmsM(top3d);
    expect(rms).not.toBeNull();
    expect(rms!).toBeLessThanOrEqual(SHELL_TOP_RING_MAX_PLANARITY_RMS_M);
    expect(shellTopRingPlanarEnoughForXyCap(top3d)).toBe(true);

    const m = extrudeShellUnderSlopedRoofWorld(ring, 0, zTop, "test-flat-cap");
    expect(m.faces.some((f) => f.kind === "top")).toBe(true);
    expect(m.faces.some((f) => f.kind === "base")).toBe(true);
  });

  it("anneau haut non plan (RMS > seuil) → omission du chapeau top, murs et base conservés", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const zTop = [0, 0, 4, 0];
    const top3d = ring.map((p, i) => ({ x: p.x, y: p.y, z: zTop[i]! }));

    const rms = computeShellTopRingPlaneFitRmsM(top3d);
    expect(rms).not.toBeNull();
    expect(rms!).toBeGreaterThan(SHELL_TOP_RING_MAX_PLANARITY_RMS_M);
    expect(shellTopRingPlanarEnoughForXyCap(top3d)).toBe(false);

    const m = extrudeShellUnderSlopedRoofWorld(ring, -1, zTop, "test-no-top-cap");
    expect(m.faces.filter((f) => f.kind === "top").length).toBe(0);
    expect(m.faces.filter((f) => f.kind === "side").length).toBeGreaterThan(0);
    expect(m.faces.filter((f) => f.kind === "base").length).toBeGreaterThan(0);
  });

  it("baseZ par sommet : empreinte basse et haut suivent les tableaux", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const zTop = [3, 3, 5, 5];
    const basePerVertex = [0, 0, 1, 1];
    const m = extrudeShellUnderSlopedRoofWorld(ring, basePerVertex, zTop, "test-per-vertex-base");
    expect(m.vertices.length).toBe(8);
    for (let i = 0; i < 4; i++) {
      expect(m.vertices[i]!.position.z).toBeCloseTo(basePerVertex[i]!, 6);
      expect(m.vertices[i + 4]!.position.z).toBeCloseTo(zTop[i]!, 6);
    }
    expect(m.faces.filter((f) => f.kind === "side").length).toBeGreaterThan(0);
  });
});
