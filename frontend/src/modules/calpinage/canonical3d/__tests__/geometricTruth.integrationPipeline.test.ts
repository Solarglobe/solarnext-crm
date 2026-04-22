/**
 * Prompt 23 — intégration : pipeline runtime → roofPlanePatches / scène, garde-fous globaux.
 */

import { describe, expect, it } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import {
  expectFinitePoint3D,
  expectNoSilentAbsurdCoordinates,
  expectNormalPointsUpish,
  expectPolygonAreaPositive,
  expectUnitNormal3D,
} from "../test-utils/geometryAssertions";

const worldContract = {
  schemaVersion: 1,
  metersPerPixel: 0.01,
  northAngleDeg: 0,
  referenceFrame: "LOCAL_IMAGE_ENU" as const,
};

/** Deux versants qui se rejoignent sur l’arête x=100 (faîtage), h explicites cohérentes. */
const twoSlopeRoofPans = [
  {
    id: "west",
    points: [
      { x: 0, y: 0, h: 5 },
      { x: 100, y: 0, h: 8 },
      { x: 100, y: 120, h: 8 },
      { x: 0, y: 120, h: 5 },
    ],
  },
  {
    id: "east",
    points: [
      { x: 100, y: 0, h: 8 },
      { x: 200, y: 0, h: 5 },
      { x: 200, y: 120, h: 5 },
      { x: 100, y: 120, h: 8 },
    ],
  },
];

const twoSlopeRuntime = {
  pans: twoSlopeRoofPans,
  roof: {
    scale: { metersPerPixel: 0.01 },
    roof: { north: { angleDeg: 0 } },
    canonical3DWorldContract: worldContract,
    roofPans: twoSlopeRoofPans,
  },
};

describe("Intégration — pipeline 3D toiture simple", () => {
  it("deux pans reliés → roofPlanePatches utilisables (aire, normale, coordonnées finies)", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(twoSlopeRuntime);
    expect(res.ok).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).not.toBeNull();
    const patches = res.scene!.roofModel.roofPlanePatches;
    expect(patches.length).toBe(2);
    const byId = new Map(patches.map((p) => [String(p.id), p]));
    const west = byId.get("west");
    const east = byId.get("east");
    expect(west && east).toBeTruthy();
    for (const p of patches) {
      expectUnitNormal3D(p.normal, `patch ${p.id} normal`);
      expectNormalPointsUpish(p.normal);
      const proj = p.surface.projectedHorizontalAreaM2;
      if (proj != null) {
        expectPolygonAreaPositive(proj, 0.5, `patch ${p.id} projectedHorizontal`);
      }
      expect(p.surface.areaM2, `patch ${p.id} areaM2`).toBeGreaterThan(0.5);
      expectNoSilentAbsurdCoordinates(p.cornersWorld);
      for (const c of p.cornersWorld) {
        expectFinitePoint3D(c, `corner ${p.id}`);
      }
    }
    const ridgeWest = west!.cornersWorld.filter((c) => Math.abs(c.x - 1) < 0.05);
    const ridgeEast = east!.cornersWorld.filter((c) => Math.abs(c.x - 1) < 0.05);
    expect(ridgeWest.length).toBeGreaterThan(0);
    expect(ridgeEast.length).toBeGreaterThan(0);
    const zw = ridgeWest.map((c) => c.z);
    const ze = ridgeEast.map((c) => c.z);
    const meanW = zw.reduce((s, z) => s + z, 0) / zw.length;
    const meanE = ze.reduce((s, z) => s + z, 0) / ze.length;
    expect(Math.abs(meanW - meanE)).toBeLessThan(0.15);
  });
});
