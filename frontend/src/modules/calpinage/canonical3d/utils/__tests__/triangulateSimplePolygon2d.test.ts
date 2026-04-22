import { describe, expect, it } from "vitest";
import { signedArea2d, triangulateSimplePolygon2dCcW } from "../triangulateSimplePolygon2d";

describe("triangulateSimplePolygon2dCcW", () => {
  it("carré unitaire → 2 triangles", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(signedArea2d(pts)).toBeGreaterThan(0);
    const tri = triangulateSimplePolygon2dCcW(pts);
    expect(tri).not.toBeNull();
    expect(tri!.length).toBe(6);
    const set = new Set(tri);
    expect(set.size).toBe(4);
  });

  it("polygone concave en L (CCW)", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(signedArea2d(pts)).toBeGreaterThan(0);
    const tri = triangulateSimplePolygon2dCcW(pts);
    expect(tri).not.toBeNull();
    expect(tri!.length).toBe((pts.length - 2) * 3);
  });
});
