/**
 * Tests unitaires — snap bord contour + validation payload (Phase 2).
 */
import { describe, it, expect } from "vitest";
import {
  buildRoofContourEdgeSnapDetailed,
  validateStructuralSnapPayload,
  resolvePointFromRoofContourEdgeAttach,
  projectPointOnSegmentClamped,
} from "../structuralSnapPhase2.js";

describe("structuralSnapPhase2", () => {
  const square = {
    id: "c1",
    roofRole: "main",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  };

  it("projette un point sur le milieu du bord bas avec attach roof_contour_edge", () => {
    var imgPt = { x: 50, y: 2 };
    var r = buildRoofContourEdgeSnapDetailed(imgPt, [square], 15);
    expect(r).not.toBeNull();
    expect(r.kind).toBe("roof_contour_edge");
    expect(r.attach.type).toBe("roof_contour_edge");
    expect(r.attach.contourId).toBe("c1");
    expect(r.attach.segmentIndex).toBe(0);
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it("pin en sommet → attach contour vertex", () => {
    var imgPt = { x: 0.2, y: 0.2 };
    var r = buildRoofContourEdgeSnapDetailed(imgPt, [square], 15);
    expect(r).not.toBeNull();
    expect(r.kind).toBe("roof_contour_vertex");
    expect(r.attach.type).toBe("contour");
    expect(r.attach.pointIndex).toBe(0);
  });

  it("resolvePointFromRoofContourEdgeAttach suit le contour", () => {
    var attach = { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.5 };
    var p = resolvePointFromRoofContourEdgeAttach(attach, [square]);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("validateStructuralSnapPayload accepte payload sans attach", () => {
    expect(
      validateStructuralSnapPayload({ x: 1, y: 2, attach: null }, "ridge", [square], [])
    ).toBe(true);
  });

  it("validateStructuralSnapPayload rejette contour inconnu", () => {
    expect(
      validateStructuralSnapPayload(
        { x: 1, y: 2, attach: { type: "contour", id: "missing", pointIndex: 0 } },
        "ridge",
        [square],
        []
      )
    ).toBe(false);
  });

  it("projectPointOnSegmentClamped extrémités", () => {
    var p = projectPointOnSegmentClamped({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(p.t).toBe(0);
    expect(p.x).toBe(0);
  });
});
