import { describe, expect, it } from "vitest";
import { segmentHorizontalLengthMFromImagePx } from "../../canonical3d/builder/worldMapping";
import {
  computeShadowCubeMetersFromAnchor,
  computeShadowTubeMetersFromAnchor,
  formatObstacle2DSelectionHud,
} from "../roofObstaclePlacement";

describe("roofObstaclePlacement — cotes monde (Niveau 2)", () => {
  const mpp = 0.02;

  it("cube : nord=0 équivalent à wPx×mpp et dPx×mpp sur les bords image", () => {
    const r = computeShadowCubeMetersFromAnchor(10, 20, 110, 70, mpp, "chimney_square", 0);
    expect(r.widthM).toBeCloseTo(100 * mpp, 8);
    expect(r.depthM).toBeCloseTo(50 * mpp, 8);
  });

  it("tube : nord=0 diamètre = hypot image × mpp", () => {
    const t = computeShadowTubeMetersFromAnchor(0, 0, 30, 40, mpp, "chimney_round", 0);
    expect(t.diameterM).toBeCloseTo(50 * mpp, 8);
  });

  it("cube : nord≠0 — largeur = distance monde le long de l’arête horizontale image", () => {
    const north = 30;
    const ax = 5;
    const ay = 5;
    const wPx = 100;
    const dPx = 40;
    const x2 = ax + wPx;
    const y2 = ay + dPx;
    const r = computeShadowCubeMetersFromAnchor(ax, ay, x2, y2, mpp, "chimney_square", north);
    const expW = segmentHorizontalLengthMFromImagePx({ x: ax, y: ay }, { x: x2, y: ay }, mpp, north);
    const expD = segmentHorizontalLengthMFromImagePx({ x: ax, y: ay }, { x: ax, y: y2 }, mpp, north);
    expect(r.widthM).toBeCloseTo(expW, 8);
    expect(r.depthM).toBeCloseTo(expD, 8);
  });

  it("HUD rect : dimensions affichées alignées segmentHorizontalLengthMFromImagePx", () => {
    const north = 45;
    const hud = formatObstacle2DSelectionHud(
      {
        meta: { businessObstacleId: "keepout_zone" },
        shapeMeta: { originalType: "rect", width: 80, height: 60 },
      },
      mpp,
      north,
    );
    const wM = segmentHorizontalLengthMFromImagePx({ x: 0, y: 0 }, { x: 80, y: 0 }, mpp, north);
    const hM = segmentHorizontalLengthMFromImagePx({ x: 0, y: 0 }, { x: 0, y: 60 }, mpp, north);
    expect(hud).toContain(wM.toFixed(2));
    expect(hud).toContain(hM.toFixed(2));
  });
});
