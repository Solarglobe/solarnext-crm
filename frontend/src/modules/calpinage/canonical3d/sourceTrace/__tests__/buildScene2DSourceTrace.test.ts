import { describe, expect, it } from "vitest";
import type { CanonicalScene3DInput } from "../../adapters/buildCanonicalScene3DInput";
import { polygonHorizontalAreaM2FromImagePx } from "../../builder/worldMapping";
import { buildScene2DSourceTraceFromCalpinage } from "../buildScene2DSourceTrace";

function minimalCanonicalScene(mpp: number, north: number): CanonicalScene3DInput {
  return {
    sceneId: "test-scene",
    world: {
      coordinateSystem: "ENU",
      zUp: true,
      northAngleDeg: north,
      metersPerPixel: mpp,
      referenceFrame: "LOCAL_IMAGE_ENU",
    },
    roof: { pans: [] },
    obstacles: { items: [] },
    panels: { items: [] },
    diagnostics: {
      isValid: true,
      is3DEligible: true,
      warnings: [],
      errors: [],
      stats: { panCount: 0, obstacleCount: 0, panelCount: 0 },
    },
  };
}

describe("buildScene2DSourceTraceFromCalpinage (Niveau 4)", () => {
  it("remplit roofOutlineHorizontalAreaM2 via polygonHorizontalAreaM2FromImagePx", () => {
    const mpp = 0.02;
    const north = 33;
    const contour = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 0, y: 40 },
    ];
    const runtime = {
      contours: [{ roofRole: "contour", points: contour }],
    };
    const trace = buildScene2DSourceTraceFromCalpinage({
      runtime,
      canonicalScene: minimalCanonicalScene(mpp, north),
      roofPlanePatchIds: ["p1"],
    });
    const exp = polygonHorizontalAreaM2FromImagePx(contour, mpp, north);
    expect(trace.metrics?.roofOutlineHorizontalAreaM2).toBeCloseTo(exp, 8);
    expect(trace.metrics?.roofOutlineArea2DPx).toBeCloseTo(50 * 40, 8);
    expect(trace.roofOutline2D?.vertexCount).toBe(4);
  });
});
