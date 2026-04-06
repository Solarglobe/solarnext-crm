/**
 * Prompt 23 — A : 2D + hauteur connue → point 3D correct (mapping horizontal + Z indépendant).
 */

import { describe, expect, it } from "vitest";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import {
  expectDeterministicImagePointToRoofPoint3D,
  expectFinitePoint3D,
  expectImageToWorldHorizontalMatchesConvention,
  expectReasonableResidentialZ,
} from "../test-utils/geometryAssertions";

describe("Géométrie A — image → monde horizontal + Z bâtiment", () => {
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
