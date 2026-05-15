import { describe, expect, it } from "vitest";
import {
  ROOF_EXTENSION_APEX_PIXEL_MERGE_TOL,
  pointsCoincidePx,
  quantizeRoofExtensionImagePxCoord,
} from "../roofExtensionApex";

describe("roofExtensionApex (P0 cohérence TS ↔ legacy)", () => {
  it("quantizeRoofExtensionImagePxCoord est deterministe (4 décimales)", () => {
    expect(quantizeRoofExtensionImagePxCoord(12.3456789)).toBe(12.3457);
    expect(quantizeRoofExtensionImagePxCoord(100)).toBe(100);
  });

  it("pointsCoincidePx accepte égalité après quantification (évite doublons fantômes)", () => {
    const ax = 2;
    const ay = 3;
    const bx = 2.00003;
    const by = 3.00004;
    expect(pointsCoincidePx(ax, ay, bx, by)).toBe(true);
  });

  it("pointsCoincidePx tolère léger jitter sous ROOF_EXTENSION_APEX_PIXEL_MERGE_TOL px", () => {
    expect(pointsCoincidePx(0, 0, 20, 0)).toBe(false);
    expect(pointsCoincidePx(0, 0, 14, 0)).toBe(true);
    expect(pointsCoincidePx(0, 0, 15, 0)).toBe(true);
    expect(ROOF_EXTENSION_APEX_PIXEL_MERGE_TOL).toBe(15);
  });
});
