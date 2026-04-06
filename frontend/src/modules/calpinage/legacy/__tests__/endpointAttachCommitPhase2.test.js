/**
 * Commit d’attach après drag — aligné sur le pipeline structural (Phase 2).
 */
import { describe, it, expect } from "vitest";
import { commitEndpointAttachFromStructuralPayload } from "../endpointAttachCommitPhase2.js";
import {
  buildRoofContourEdgeSnapDetailed,
  validateStructuralSnapPayload,
  resolvePointFromRoofContourEdgeAttach,
} from "../structuralSnapPhase2.js";
import { collectMandatoryContourSplitPointsFromStructuralEndpoints } from "../pansTopologyPhase2.js";

describe("commitEndpointAttachFromStructuralPayload", () => {
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
  const contours = [square];
  const traits = [{ id: "t1", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } }];

  it("A — milieu de segment contour → roof_contour_edge (ridge)", () => {
    var imgPt = { x: 50, y: 2 };
    var edgeDet = buildRoofContourEdgeSnapDetailed(imgPt, contours, 15);
    expect(edgeDet).not.toBeNull();
    expect(edgeDet.attach.type).toBe("roof_contour_edge");
    var payload = {
      x: edgeDet.x,
      y: edgeDet.y,
      attach: edgeDet.attach,
    };
    var out = commitEndpointAttachFromStructuralPayload(imgPt, "ridge", contours, traits, payload);
    expect(out.attach.type).toBe("roof_contour_edge");
    expect(out.attach.contourId).toBe("c1");
    expect(typeof out.attach.segmentIndex).toBe("number");
    expect(typeof out.attach.t).toBe("number");
    expect(out.attach.pointIndex).toBeUndefined();
  });

  it("B — milieu de segment contour → roof_contour_edge (trait)", () => {
    var imgPt = { x: 50, y: 1 };
    var edgeDet = buildRoofContourEdgeSnapDetailed(imgPt, contours, 15);
    var payload = { x: edgeDet.x, y: edgeDet.y, attach: edgeDet.attach };
    var out = commitEndpointAttachFromStructuralPayload(imgPt, "trait", contours, traits, payload);
    expect(out.attach.type).toBe("roof_contour_edge");
  });

  it("C — sommet contour → contour + pointIndex numérique", () => {
    var imgPt = { x: 0.2, y: 0.2 };
    var edgeDet = buildRoofContourEdgeSnapDetailed(imgPt, contours, 15);
    expect(edgeDet.attach.type).toBe("contour");
    expect(typeof edgeDet.attach.pointIndex).toBe("number");
    var payload = { x: edgeDet.x, y: edgeDet.y, attach: edgeDet.attach };
    var out = commitEndpointAttachFromStructuralPayload(imgPt, "ridge", contours, traits, payload);
    expect(out.attach.type).toBe("contour");
    expect(out.attach.pointIndex).toBe(0);
  });

  it("D — payload invalide (contour supprimé) → fallback imgPt, attach null", () => {
    var imgPt = { x: 42, y: 42 };
    var payload = {
      x: 50,
      y: 0,
      attach: { type: "contour", id: "missing", pointIndex: 0 },
    };
    var out = commitEndpointAttachFromStructuralPayload(imgPt, "ridge", contours, traits, payload);
    expect(out.attach).toBeNull();
    expect(out.x).toBe(42);
    expect(out.y).toBe(42);
  });

  it("E — non-régression validateStructuralSnapPayload + attach enrichi", () => {
    var attach = { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.5 };
    var payload = { x: 50, y: 0, attach };
    expect(validateStructuralSnapPayload(payload, "ridge", contours, traits)).toBe(true);
    var out = commitEndpointAttachFromStructuralPayload({ x: 50, y: 0 }, "ridge", contours, traits, payload);
    var p = resolvePointFromRoofContourEdgeAttach(out.attach, contours);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("F — roof_contour_edge conservé → collectMandatoryContourSplitPointsFromStructuralEndpoints", () => {
    var attach = { type: "roof_contour_edge", contourId: "c1", segmentIndex: 0, t: 0.5 };
    var endpoint = { x: 50, y: 0, attach };
    var state = { contours };
    var contourEdges = [{ ref: square }];
    var ridgeRefs = [{ a: endpoint, b: { x: 50, y: 50 } }];
    var r = collectMandatoryContourSplitPointsFromStructuralEndpoints(state, contourEdges, ridgeRefs, [], 2);
    var flats = Object.keys(r.mandatoryByFlatSeg);
    expect(flats.length).toBeGreaterThanOrEqual(1);
    expect(r.mandatoryByFlatSeg[flats[0]].length).toBeGreaterThanOrEqual(1);
  });
});
