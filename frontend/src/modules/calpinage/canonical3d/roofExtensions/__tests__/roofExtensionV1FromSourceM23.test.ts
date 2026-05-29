import { describe, expect, it } from "vitest";
import { buildRoofExtensionV1FromSource } from "../buildRoofExtensionV1FromSource";
import type { RoofExtensionSource2D } from "../roofExtensionSource";
import { makeSupportPatch } from "./roofExtensionVolumeTestUtils";

function makeSource(overrides: Partial<RoofExtensionSource2D> = {}): RoofExtensionSource2D {
  return {
    id: "ext-m23",
    kind: "gable",
    sourceIndex: 0,
    stage: null,
    visualModel: null,
    supportPanId: "pan1",
    // 4x3 px rectangle => horizontal area = 12 m2 (metersPerPixel=1)
    contour: [
      { x: 0, y: 0, heightRelM: 0 },
      { x: 4, y: 0, heightRelM: 0 },
      { x: 4, y: 3, heightRelM: 0 },
      { x: 0, y: 3, heightRelM: 0 },
    ],
    ridge: {
      a: { x: 0, y: 1.5, heightRelM: 0 },
      b: { x: 4, y: 1.5, heightRelM: 0 },
    },
    hips: null,
    apexVertex: null,
    ridgeHeightRelM: 1.5,
    wallHeightM: null,
    heightReference: "support_plane_normal",
    hadLegacyCanonicalDormerGeometry: false,
    warnings: [],
    ...overrides,
  };
}

describe("M23 -- footprintAreaM2 corrige par 1/cos(slopeDeg) sur pan incline", () => {
  it("pan plat (0 deg) : footprintAreaM2 = aire horizontale (pas de correction)", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({ source: makeSource(), supportPatch: patch, metersPerPixel: 1, northAngleDeg: 0 });
    // Horizontal area = 4*3 = 12 m2; cos(0)=1 => no correction
    expect(result.model?.dimensions.footprintAreaM2).toBeCloseTo(12, 4);
  });

  it("pan 30 deg : footprintAreaM2 = aire_horizontale / cos(30deg) ~ 13.856 m2 (M23)", () => {
    const patch = makeSupportPatch("pan1", 30);
    const result = buildRoofExtensionV1FromSource({ source: makeSource(), supportPatch: patch, metersPerPixel: 1, northAngleDeg: 0 });
    const horizontalArea = 12;
    const cos30 = Math.cos(30 * Math.PI / 180);
    const expected = horizontalArea / cos30; // ~13.856
    expect(result.model?.dimensions.footprintAreaM2).toBeCloseTo(expected, 4);
    // Verify the slope factor is ~1.155
    const ratio = (result.model?.dimensions.footprintAreaM2 ?? 0) / horizontalArea;
    expect(ratio).toBeGreaterThan(1.154);
    expect(ratio).toBeLessThan(1.156);
  });

  it("pan 45 deg : footprintAreaM2 = aire_horizontale * sqrt(2) (M23)", () => {
    const patch = makeSupportPatch("pan1", 45);
    const result = buildRoofExtensionV1FromSource({ source: makeSource(), supportPatch: patch, metersPerPixel: 1, northAngleDeg: 0 });
    const expected = 12 / Math.cos(45 * Math.PI / 180); // 12*sqrt(2) ~ 16.971
    expect(result.model?.dimensions.footprintAreaM2).toBeCloseTo(expected, 3);
  });
});
