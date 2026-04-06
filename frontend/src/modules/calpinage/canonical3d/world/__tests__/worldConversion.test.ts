/**
 * Roundtrip et contrat monde officiel (`world/`).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeWorldConfig,
  peekCalpinageRuntimeWorldFrame,
  WorldConfigError,
  WORLD_CONFIG_ERROR_CODES,
} from "../normalizeWorldConfig";
import { imagePointToWorld } from "../imageToWorld";
import { worldPointToImage } from "../worldToImage";

describe("worldConversion — image ↔ monde (ENU Z-up)", () => {
  it("Cas 1 — identité simple (mpp=1, nord=0), roundtrip ≈ identique", () => {
    const config = normalizeWorldConfig({
      metersPerPixel: 1,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
    });
    const pt = { x: 12.5, y: 88 };
    const w = imagePointToWorld(pt, config);
    const back = worldPointToImage(w, config);
    expect(w.z).toBe(0);
    expect(back.x).toBeCloseTo(pt.x, 10);
    expect(back.y).toBeCloseTo(pt.y, 10);
  });

  it("Cas 2 — scale mpp=0.2", () => {
    const config = normalizeWorldConfig({
      metersPerPixel: 0.2,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
    });
    const pt = { x: 100, y: 50 };
    const w = imagePointToWorld(pt, config);
    expect(w.x).toBeCloseTo(20, 10);
    expect(w.y).toBeCloseTo(-10, 10);
    expect(w.z).toBe(0);
    const back = worldPointToImage(w, config);
    expect(back.x).toBeCloseTo(100, 9);
    expect(back.y).toBeCloseTo(50, 9);
  });

  it("Cas 3 — rotation nord 90°", () => {
    const config = normalizeWorldConfig({
      metersPerPixel: 1,
      northAngleDeg: 90,
      referenceFrame: "LOCAL_IMAGE_ENU",
    });
    const pt = { x: 10, y: 0 };
    const w = imagePointToWorld(pt, config);
    const back = worldPointToImage(w, config);
    expect(w.z).toBe(0);
    expect(back.x).toBeCloseTo(pt.x, 9);
    expect(back.y).toBeCloseTo(pt.y, 9);
  });

  it("Cas 4 — config invalide : metersPerPixel <= 0 → WORLD_CONFIG_INVALID", () => {
    for (const mpp of [0, -0.1]) {
      try {
        normalizeWorldConfig({
          metersPerPixel: mpp,
          northAngleDeg: 0,
          referenceFrame: "LOCAL_IMAGE_ENU",
        });
        expect.fail("expected throw");
      } catch (e) {
        expect(e).toMatchObject({ code: WORLD_CONFIG_ERROR_CODES.WORLD_CONFIG_INVALID });
      }
    }
  });

  it("Cas 5 — cohérence Z-up : imagePointToWorld z === 0", () => {
    const config = normalizeWorldConfig({
      metersPerPixel: 0.05,
      northAngleDeg: 12.3,
      referenceFrame: "LOCAL_IMAGE_ENU",
    });
    expect(imagePointToWorld({ x: 1, y: 2 }, config).z).toBe(0);
  });

  it("peekCalpinageRuntimeWorldFrame lit state minimal (nord explicite + contrat aligné scale/nord)", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 33 } },
        canonical3DWorldContract: {
          schemaVersion: 1,
          metersPerPixel: 0.02,
          northAngleDeg: 33,
          referenceFrame: "LOCAL_IMAGE_ENU",
        },
      },
    };
    const p = peekCalpinageRuntimeWorldFrame(state);
    expect(p?.metersPerPixel).toBe(0.02);
    expect(p?.northAngleDeg).toBe(33);
    expect(p?.referenceFrame).toBe("LOCAL_IMAGE_ENU");
  });

  it("normalizeWorldConfig : WORLD_REFERENCE_FRAME_MISSING sans referenceFrame", () => {
    expect(() => normalizeWorldConfig({ metersPerPixel: 1, northAngleDeg: 0 })).toThrow(WorldConfigError);
    try {
      normalizeWorldConfig({ metersPerPixel: 1, northAngleDeg: 0 });
    } catch (e) {
      expect(e).toMatchObject({ code: WORLD_CONFIG_ERROR_CODES.WORLD_REFERENCE_FRAME_MISSING });
    }
  });

  it("normalizeWorldConfig : WORLD_NORTH_MISSING sans northAngleDeg", () => {
    try {
      normalizeWorldConfig({ metersPerPixel: 1, referenceFrame: "LOCAL_IMAGE_ENU" });
    } catch (e) {
      expect(e).toMatchObject({ code: WORLD_CONFIG_ERROR_CODES.WORLD_NORTH_MISSING });
    }
  });

  it("normalizeWorldConfig : WORLD_MPP_MISSING sans metersPerPixel", () => {
    try {
      normalizeWorldConfig({ northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" });
    } catch (e) {
      expect(e).toMatchObject({ code: WORLD_CONFIG_ERROR_CODES.WORLD_MPP_MISSING });
    }
  });

  it("peekCalpinageRuntimeWorldFrame : pas de nord implicite si angle absent", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: {},
        canonical3DWorldContract: { referenceFrame: "LOCAL_IMAGE_ENU" },
      },
    };
    const p = peekCalpinageRuntimeWorldFrame(state);
    expect(p?.northAngleDeg).toBeUndefined();
    expect(p?.referenceFrame).toBeUndefined();
  });

  it("peekCalpinageRuntimeWorldFrame : contrat désynchronisé → pas de referenceFrame (anti-fraude)", () => {
    const state = {
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 10 } },
        canonical3DWorldContract: {
          metersPerPixel: 0.02,
          northAngleDeg: 99,
          referenceFrame: "LOCAL_IMAGE_ENU",
        },
      },
    };
    const p = peekCalpinageRuntimeWorldFrame(state);
    expect(p?.northAngleDeg).toBe(10);
    expect(p?.referenceFrame).toBeUndefined();
  });
});
