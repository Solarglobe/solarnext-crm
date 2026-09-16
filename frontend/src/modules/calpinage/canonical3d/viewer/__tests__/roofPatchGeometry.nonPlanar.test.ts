import { describe, expect, it } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import { evaluateRoofPatchGeometryTruth } from "../../validation/geometricTruthStatus";
import { roofPatchGeometry } from "../solarSceneThreeGeometry";

/** Slightly unequal surveyed ridge heights, with a simple rectangular footprint. */
function surveyedPatch(heightOffset = 0.3, reverse = false) {
  const polygonPx = [
    { xPx: 0, yPx: 0, heightM: 3 },
    { xPx: 1000, yPx: 0, heightM: 3 },
    { xPx: 1000, yPx: 800, heightM: 7 },
    { xPx: 0, yPx: 800, heightM: 7 + heightOffset },
  ];
  return buildRoofModel3DFromLegacyGeometry({
    metersPerPixel: 0.01,
    northAngleDeg: 23,
    defaultHeightM: 3,
    pans: [{ id: "surveyed-roof", polygonPx: reverse ? polygonPx.reverse() : polygonPx }],
  }, { roofGeometryFidelityMode: "fidelity" }).model.roofPlanePatches[0]!;
}

describe("roof surface with non-coplanar surveyed corners", () => {
  it.each([false, true])("keeps the roof visible without changing the surveyed heights (reverse=%s)", (reverse) => {
    const patch = surveyedPatch(0.3, reverse);
    const before = structuredClone(patch);
    const truth = evaluateRoofPatchGeometryTruth(patch);
    const geometry = roofPatchGeometry(patch);
    try {
      expect(truth.triangulation.areaDeltaM2).toBeGreaterThan(truth.triangulation.polygonAreaM2 * 0.0001);
      expect(geometry.getIndex()!.count).toBe(6);
      expect(truth.status).toBe("DEGRADED");
      expect(truth.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TRIANGULATION_NON_PLANAR_SURFACE", severity: "warning" })]));
      expect(truth.triangulation.triangleCentroidsOutsideCount).toBe(0);
      expect(truth.triangulation.degenerateTriangleCount).toBe(0);
      expect(patch).toEqual(before);
      const positions = geometry.getAttribute("position");
      patch.cornersWorld.forEach((p, i) => {
        expect(positions.getX(i)).toBeCloseTo(p.x, 5);
        expect(positions.getY(i)).toBeCloseTo(p.y, 5);
        expect(positions.getZ(i)).toBeCloseTo(p.z, 5);
      });
    } finally { geometry.dispose(); }
  });

  it("keeps an actually planar roof valid", () => {
    expect(evaluateRoofPatchGeometryTruth(surveyedPatch(0)).status).toBe("VALID");
  });

  it("still rejects a cached UV contour whose area does not match the actual roof", () => {
    const patch = surveyedPatch(0);
    const inconsistent = { ...patch, polygon2DInPlane: patch.polygon2DInPlane!.map(p => ({ u: p.u * 2, v: p.v * 2 })) };
    const truth = evaluateRoofPatchGeometryTruth(inconsistent);
    const geometry = roofPatchGeometry(inconsistent);
    try {
      expect(truth.status).toBe("INVALID");
      expect(truth.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TRIANGULATION_SURFACE_MISMATCH", severity: "error" })]));
      expect(geometry.getIndex()!.count).toBe(0);
    } finally { geometry.dispose(); }
  });
});
