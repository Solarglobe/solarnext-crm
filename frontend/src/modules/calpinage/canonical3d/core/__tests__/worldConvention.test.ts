import { describe, expect, it } from "vitest";
import { imagePxToWorldHorizontalM } from "../../builder/worldMapping";
import {
  getWorldUnitScale,
  imagePointToWorldHorizontal,
  normalizeWorldVector,
  worldHorizontalToImagePoint,
  worldPointToViewer,
} from "../worldConvention";

describe("worldConvention — fondation", () => {
  const mpp = 0.05;
  const north0 = 0;

  it("imagePointToWorldHorizontal === imagePxToWorldHorizontalM (délégation stable)", () => {
    const a = imagePointToWorldHorizontal({ xPx: 100, yPx: 200 }, mpp, north0);
    const b = imagePxToWorldHorizontalM(100, 200, mpp, north0);
    expect(a).toEqual(b);
  });

  it("aller-retour image → monde horizontal → image (north=0, pas d’inversion silencieuse)", () => {
    const xPx = 640;
    const yPx = 480;
    const h = imagePointToWorldHorizontal({ xPx, yPx }, mpp, north0);
    const back = worldHorizontalToImagePoint(h.x, h.y, mpp, north0);
    expect(back.xPx).toBeCloseTo(xPx, 10);
    expect(back.yPx).toBeCloseTo(yPx, 10);
  });

  it("aller-retour stable avec rotation nord non nulle", () => {
    const north = 37.5;
    const xPx = 120;
    const yPx = -40;
    const h = imagePointToWorldHorizontal({ xPx, yPx }, mpp, north);
    const back = worldHorizontalToImagePoint(h.x, h.y, mpp, north);
    expect(back.xPx).toBeCloseTo(xPx, 9);
    expect(back.yPx).toBeCloseTo(yPx, 9);
  });

  it("signe Y image : y pixel positif (bas image) → y monde opposé à +x_px simple (cohérent worldMapping)", () => {
    const hDown = imagePointToWorldHorizontal({ xPx: 0, yPx: 100 }, 1, 0);
    const hUp = imagePointToWorldHorizontal({ xPx: 0, yPx: -100 }, 1, 0);
    expect(hDown.y).toBe(-100);
    expect(hUp.y).toBe(100);
  });

  it("getWorldUnitScale : world = 1 m par unité, mpp exposé", () => {
    const s = getWorldUnitScale(mpp);
    expect(s.worldMetersPerUnit).toBe(1);
    expect(s.metersPerImagePixel).toBe(mpp);
  });

  it("worldPointToViewer est l’identité (viewer officiel = coords monde)", () => {
    const p = { x: 1.2, y: -3.4, z: 5.6 };
    expect(worldPointToViewer(p)).toEqual(p);
  });

  it("normalizeWorldVector : unitaire pour vecteur non nul, null pour zéro", () => {
    const u = normalizeWorldVector({ x: 3, y: 0, z: 4 });
    expect(u).not.toBeNull();
    expect(u!.x).toBeCloseTo(0.6, 6);
    expect(u!.y).toBeCloseTo(0, 6);
    expect(u!.z).toBeCloseTo(0.8, 6);
    expect(normalizeWorldVector({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});
