import { describe, expect, it } from "vitest";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import {
  closestPointOnPolygonBoundaryXY,
  resolveLocalRoofZAtXY,
  resolveRoofPlaneZAtXYFromPatches,
  resolveShellContourVertexWorldXYAndZ,
} from "../shellContourLocalRoofZ";

/** Carré [0,2]×[0,2] avec z = x (plan incliné) — point (3,1) hors emprise : extrapolation ancienne donnait z≈3. */
function slopedPanZEqualsXOn2mSquare(): RoofPlanePatch3D {
  const nl = Math.SQRT2;
  const normal = { x: -1 / nl, y: 0, z: 1 / nl };
  const cornersWorld = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 2 },
    { x: 2, y: 2, z: 2 },
    { x: 0, y: 2, z: 0 },
  ];
  return {
    id: "slope-z-eq-x",
    topologyRole: "primary_shell",
    boundaryVertexIds: ["a", "b", "c", "d"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld,
    localFrame: {
      role: "roof_face",
      origin: { ...cornersWorld[0]! },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: 0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 1, y: 1, z: 1 },
    surface: { areaM2: 8, projectedHorizontalAreaM2: 4 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

describe("shellContourLocalRoofZ — Phase A4 hors emprise", () => {
  it("closestPointOnPolygonBoundaryXY : point extérieur → projeté sur le bord", () => {
    const c = closestPointOnPolygonBoundaryXY(3, 1, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(c).not.toBeNull();
    expect(c!.x).toBeCloseTo(2, 8);
    expect(c!.y).toBeCloseTo(1, 8);
  });

  it("hors emprise : Z = plan du patch au (x,y) query (pas snap bord) — ici z = x sur le plan", () => {
    const p = slopedPanZEqualsXOn2mSquare();
    const z = resolveLocalRoofZAtXY([p], 3, 1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(3, 5);
  });

  it("resolveShellContourVertexWorldXYAndZ : hors emprise → XY recalés sur le bord (cohérence shell/toiture)", () => {
    const p = slopedPanZEqualsXOn2mSquare();
    const r = resolveShellContourVertexWorldXYAndZ([p], 3, 1);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(2, 5);
    expect(r!.y).toBeCloseTo(1, 5);
    expect(r!.z).toBeCloseTo(2, 5);
  });

  it("dans l’empreinte : inchangé (plan au point query)", () => {
    const p = slopedPanZEqualsXOn2mSquare();
    const z = resolveLocalRoofZAtXY([p], 1, 1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(1, 5);
  });

  it("pan horizontal : hors emprise mais proche du bord → Z cohérent avec le bord", () => {
    const flat = makeHorizontalSquarePatch("flat", 2, 1.5);
    const z = resolveLocalRoofZAtXY([flat], 2.5, 0.5);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(1.5, 5);
  });

  it("hors emprise lointaine : fallback = plan du patch le plus proche en XY, Z au (x,y) query", () => {
    const flat = makeHorizontalSquarePatch("far", 2, 0);
    const z = resolveLocalRoofZAtXY([flat], 120, 0);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(0, 5);
  });

  it("resolveRoofPlaneZAtXYFromPatches : bord d’empreinte inclus → Z = plan au (x,y) exact", () => {
    const flat = makeHorizontalSquarePatch("flat", 2, 1.5);
    const z = resolveRoofPlaneZAtXYFromPatches([flat], 2, 1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(1.5, 5);
  });
});
