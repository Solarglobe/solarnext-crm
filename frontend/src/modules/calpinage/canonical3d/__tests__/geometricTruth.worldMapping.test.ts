/**
 * Prompt 23 — A : 2D + hauteur connue → point 3D correct (mapping horizontal + Z indépendant).
 */

import { describe, expect, it } from "vitest";
import {
  imagePxToWorldHorizontalM,
  polygonHorizontalAreaM2FromImagePx,
  segmentHorizontalLengthMFromImagePx,
} from "../builder/worldMapping";
import {
  expectDeterministicImagePointToRoofPoint3D,
  expectFinitePoint3D,
  expectImageToWorldHorizontalMatchesConvention,
  expectReasonableResidentialZ,
} from "../test-utils/geometryAssertions";

describe("Géométrie A — image → monde horizontal + Z bâtiment", () => {
  it("polygonHorizontalAreaM2FromImagePx : carré 10×10 px, mpp=0.02 → 0,04 m² (nord 0)", () => {
    const mpp = 0.02;
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const a = polygonHorizontalAreaM2FromImagePx(ring, mpp, 0);
    expect(a).toBeCloseTo(10 * 10 * mpp * mpp, 10);
  });

  it("polygonHorizontalAreaM2FromImagePx : égalité shoelace px × mpp² (nord 40°)", () => {
    const mpp = 0.03;
    const north = 40;
    const ring = [
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 40, y: 30 },
      { x: 10, y: 35 },
    ];
    let s = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s += ring[i]!.x * ring[j]!.y - ring[j]!.x * ring[i]!.y;
    }
    const areaPx = Math.abs(s) * 0.5;
    const aWorld = polygonHorizontalAreaM2FromImagePx(ring, mpp, north);
    expect(aWorld).toBeCloseTo(areaPx * mpp * mpp, 8);
  });

  it("segmentHorizontalLengthMFromImagePx : aligné sur hypot(imagePxToWorld)", () => {
    const mpp = 0.02;
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const len = segmentHorizontalLengthMFromImagePx(a, b, mpp, 0);
    const aw = imagePxToWorldHorizontalM(a.x, a.y, mpp, 0);
    const bw = imagePxToWorldHorizontalM(b.x, b.y, mpp, 0);
    expect(len).toBeCloseTo(Math.hypot(bw.x - aw.x, bw.y - aw.y), 10);
    expect(len).toBeCloseTo(2, 10);
  });

  it("north=0 : xWorld = xPx*mpp, yWorld = -yPx*mpp (pas de confusion Y image ↔ Z monde)", () => {
    const mpp = 0.02;
    const xPx = 300;
    const yPx = 400;
    const w = imagePxToWorldHorizontalM(xPx, yPx, mpp, 0);
    expect(w.x).toBeCloseTo(6, 10);
    expect(w.y).toBeCloseTo(-8, 10);
  });

  it("rotation nord 90° : formule déterministe réversible", () => {
    const mpp = 0.01;
    const p = imagePxToWorldHorizontalM(100, 200, mpp, 90);
    const rad = Math.PI / 2;
    const x0 = 1;
    const y0 = -2;
    expect(p.x).toBeCloseTo(x0 * Math.cos(rad) - y0 * Math.sin(rad), 8);
    expect(p.y).toBeCloseTo(x0 * Math.sin(rad) + y0 * Math.cos(rad), 8);
  });

  it("un sommet pan avec h explicite : xWorldM/yWorldM suivent la convention, zWorldM = h", () => {
    const mpp = 0.05;
    const north = 0;
    const xPx = 10;
    const yPx = 20;
    const h = 7.25;
    const xy = imagePxToWorldHorizontalM(xPx, yPx, mpp, north);
    const v = { x: xy.x, y: xy.y, z: h };
    expectImageToWorldHorizontalMatchesConvention(xPx, yPx, mpp, north, v.x, v.y);
    expectFinitePoint3D(v, "vertex");
    expect(v.z).toBe(h);
    expectReasonableResidentialZ(h);
    expectDeterministicImagePointToRoofPoint3D({
      xPx,
      yPx,
      zWorldM: h,
      metersPerPixel: mpp,
      northAngleDeg: north,
    });
  });
});
