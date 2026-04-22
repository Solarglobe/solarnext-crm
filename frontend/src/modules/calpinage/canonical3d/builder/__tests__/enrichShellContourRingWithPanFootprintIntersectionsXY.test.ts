import { describe, expect, it } from "vitest";
import {
  collectRoofPatchFootprintEdgesXY,
  enrichShellContourRingWithPanFootprintIntersectionsXY,
  intersectOpenContourSegmentWithFootprintEdge2d,
} from "../enrichShellContourRingWithPanFootprintIntersectionsXY";
import { makeHorizontalSquarePatch, translatePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import { vec3 } from "../../utils/math3";

describe("enrichShellContourRingWithPanFootprintIntersectionsXY", () => {
  it("intersection ouverte : segment horizontal croise une arête verticale d’empreinte", () => {
    const hit = intersectOpenContourSegmentWithFootprintEdge2d(0, 0, 4, 0, 2, 0, 2, 2);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(2, 8);
    expect(hit!.y).toBeCloseTo(0, 8);
    expect(hit!.t).toBeCloseTo(0.5, 8);
  });

  it("deux rectangles adjacents : contour englobant reçoit les points sur la ligne de séparation XY", () => {
    const pa = makeHorizontalSquarePatch("pan-a", 2, 0);
    const pb = translatePatch(makeHorizontalSquarePatch("pan-b", 2, 0), vec3(2, 0, 0));
    const patches = [pa, pb];

    const edges = collectRoofPatchFootprintEdgesXY(patches);
    expect(edges.length).toBe(8);

    const ring = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ];
    const enriched = enrichShellContourRingWithPanFootprintIntersectionsXY(ring, patches);

    expect(enriched.length).toBeGreaterThanOrEqual(ring.length + 2);
    expect(enriched.some((p) => Math.abs(p.x - 2) < 1e-8 && Math.abs(p.y) < 1e-8)).toBe(true);
    expect(enriched.some((p) => Math.abs(p.x - 2) < 1e-8 && Math.abs(p.y - 2) < 1e-8)).toBe(true);
  });

  it("sans pans : anneau inchangé (copie)", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const out = enrichShellContourRingWithPanFootprintIntersectionsXY(ring, []);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(ring[0]!);
  });
});
