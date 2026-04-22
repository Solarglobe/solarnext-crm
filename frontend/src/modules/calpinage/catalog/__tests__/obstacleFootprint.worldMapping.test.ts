import { describe, expect, it } from "vitest";
import { polygonHorizontalAreaM2FromImagePx } from "../../canonical3d/builder/worldMapping";
import { computeObstacleFootprintAreaM2 } from "../obstacleFootprint";

describe("computeObstacleFootprintAreaM2 (Niveau 3)", () => {
  const mpp = 0.02;

  it("polygone : aligné sur polygonHorizontalAreaM2FromImagePx", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 0, y: 40 },
    ];
    const north = 25;
    expect(computeObstacleFootprintAreaM2({ points: pts }, mpp, north)).toBeCloseTo(
      polygonHorizontalAreaM2FromImagePx(pts, mpp, north),
      8,
    );
  });

  it("rectangle shapeMeta : produit des côtés monde (nord 0 = w×h×mpp²)", () => {
    const a = computeObstacleFootprintAreaM2(
      { shapeMeta: { originalType: "rect", width: 100, height: 50 } },
      mpp,
      0,
    );
    expect(a).toBeCloseTo(100 * 50 * mpp * mpp, 8);
  });
});
