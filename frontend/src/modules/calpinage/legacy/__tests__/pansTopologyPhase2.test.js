import { describe, it, expect } from "vitest";
import {
  flattenContourSegmentIndex,
  collectMandatoryContourSplitPointsFromStructuralEndpoints,
  isStructuralContourAttach,
} from "../pansTopologyPhase2.js";

describe("pansTopologyPhase2", () => {
  it("flattenContourSegmentIndex aligne avec l’ordre des segments contour", () => {
    var contourEdges = [
      { ref: { id: "c1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] } },
      { ref: { id: "c2", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] } },
    ];
    expect(flattenContourSegmentIndex(contourEdges, "c1", 0)).toBe(0);
    expect(flattenContourSegmentIndex(contourEdges, "c1", 1)).toBe(1);
    expect(flattenContourSegmentIndex(contourEdges, "c1", 2)).toBe(2);
    expect(flattenContourSegmentIndex(contourEdges, "c2", 0)).toBe(3);
    expect(flattenContourSegmentIndex(contourEdges, "c2", 1)).toBe(4);
  });

  it("isStructuralContourAttach reconnaît roof_contour_edge et contour", () => {
    expect(isStructuralContourAttach({ x: 0, y: 0, attach: { type: "roof_contour_edge", contourId: "c", segmentIndex: 0, t: 0.5 } })).toBe(true);
    expect(isStructuralContourAttach({ x: 0, y: 0, attach: { type: "contour", id: "c", pointIndex: 0 } })).toBe(true);
    expect(isStructuralContourAttach({ x: 0, y: 0 })).toBe(false);
  });

  it("injecte un point intérieur pour roof_contour_edge", () => {
    var state = {
      contours: [
        {
          id: "roof",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
        },
      ],
    };
    var contourEdges = [{ ref: state.contours[0] }];
    var ridges = [
      {
        a: { x: 1, y: 1, attach: { type: "roof_contour_edge", contourId: "roof", segmentIndex: 0, t: 0.5 } },
        b: { x: 50, y: 50 },
      },
    ];
    var { mandatoryByFlatSeg } = collectMandatoryContourSplitPointsFromStructuralEndpoints(
      state,
      contourEdges,
      ridges,
      [],
      2
    );
    expect(mandatoryByFlatSeg[0]).toBeDefined();
    expect(mandatoryByFlatSeg[0].length).toBe(1);
    expect(mandatoryByFlatSeg[0][0].x).toBeCloseTo(50, 5);
    expect(mandatoryByFlatSeg[0][0].y).toBeCloseTo(0, 5);
  });

  it("ne crée pas de point intérieur si proche d’un sommet (pin)", () => {
    var state = {
      contours: [
        {
          id: "roof",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ],
    };
    var contourEdges = [{ ref: state.contours[0] }];
    var ridges = [
      {
        a: {
          x: 1,
          y: 0,
          attach: { type: "roof_contour_edge", contourId: "roof", segmentIndex: 0, t: 0.01 },
        },
        b: { x: 50, y: 50 },
      },
    ];
    var { mandatoryByFlatSeg, debug } = collectMandatoryContourSplitPointsFromStructuralEndpoints(
      state,
      contourEdges,
      ridges,
      [],
      5
    );
    expect(Object.keys(mandatoryByFlatSeg).length).toBe(0);
    expect(debug.some(function (d) { return d.action === "reuse_vertex"; })).toBe(true);
  });
});
