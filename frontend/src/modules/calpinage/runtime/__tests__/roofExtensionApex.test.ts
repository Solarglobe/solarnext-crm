import { describe, expect, it } from "vitest";
import {
  ROOF_EXTENSION_APEX_PIXEL_MERGE_TOL,
  intersectInfiniteLines2D,
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

  it("intersectInfiniteLines2D retourne null pour deux lignes strictement paralleles (M20)", () => {
    // L1: (0,0)-(4000,0), L2: (0,1)-(4000,1) => same direction, det=0
    expect(intersectInfiniteLines2D(0, 0, 4000, 0, 0, 1, 4000, 1)).toBeNull();
  });

  it("intersectInfiniteLines2D retourne null pour lignes quasi-paralleles en coords image (M20)", () => {
    // L1: (0,0)-(3000,3000), L2: (1,0)-(3001, 3000*(1+1e-10))
    // det ~ 9e-4, scale = max(|a1*b2|, |a2*b1|, 1) = 9e6 => threshold=9 > det => null
    const eps = 1e-10;
    expect(intersectInfiniteLines2D(0, 0, 3000, 3000, 1, 0, 3001, 3000 * (1 + eps))).toBeNull();
  });
});