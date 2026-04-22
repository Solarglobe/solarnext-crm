import { describe, expect, it } from "vitest";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { clipBuildingContourRingXYToRoofCoverageWorld } from "../shellFootprintUnionWorldXY";

describe("clipBuildingContourRingXYToRoofCoverageWorld", () => {
  it("contour identique au pan : intersection = même emprise (à la tolérance numérique)", () => {
    const roof = makeHorizontalSquarePatch("r", 10, 0);
    const contour: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const clipped = clipBuildingContourRingXYToRoofCoverageWorld(contour, [roof]);
    expect(clipped).not.toBeNull();
    expect(clipped!.length).toBeGreaterThanOrEqual(3);
    const ac = Math.abs(
      clipped!.reduce((s, p, i, a) => {
        const j = (i + 1) % a.length;
        return s + (p.x * a[j]!.y - a[j]!.x * p.y);
      }, 0) * 0.5,
    );
    expect(ac).toBeCloseTo(100, 0);
  });

  it("contour bâti plus grand que le pan : shell limité à l’empreinte toiture (100 m² vs 25 m²)", () => {
    const roof = makeHorizontalSquarePatch("r", 5, 0);
    const contour: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const clipped = clipBuildingContourRingXYToRoofCoverageWorld(contour, [roof]);
    expect(clipped).not.toBeNull();
    const area = Math.abs(
      clipped!.reduce((s, p, i, a) => {
        const j = (i + 1) % a.length;
        return s + (p.x * a[j]!.y - a[j]!.x * p.y);
      }, 0) * 0.5,
    );
    expect(area).toBeCloseTo(25, 1);
  });

  it("sans chevauchement contour / toiture → null", () => {
    const roof = makeHorizontalSquarePatch("r", 2, 0);
    const contour: { x: number; y: number }[] = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ];
    expect(clipBuildingContourRingXYToRoofCoverageWorld(contour, [roof])).toBeNull();
  });

  it("deux pans adjacents : union puis intersection avec contour englobant", () => {
    const a: RoofPlanePatch3D = {
      ...makeHorizontalSquarePatch("pa", 5, 0),
      id: "pa",
      cornersWorld: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 5, z: 0 },
        { x: 0, y: 5, z: 0 },
      ],
    };
    const b: RoofPlanePatch3D = {
      ...makeHorizontalSquarePatch("pb", 5, 0),
      id: "pb",
      cornersWorld: [
        { x: 5, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 5, z: 0 },
        { x: 5, y: 5, z: 0 },
      ],
    };
    const contour: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ];
    const clipped = clipBuildingContourRingXYToRoofCoverageWorld(contour, [a, b]);
    expect(clipped).not.toBeNull();
    const area = Math.abs(
      clipped!.reduce((s, p, i, arr) => {
        const j = (i + 1) % arr.length;
        return s + (p.x * arr[j]!.y - arr[j]!.x * p.y);
      }, 0) * 0.5,
    );
    expect(area).toBeCloseTo(50, 0);
  });
});
