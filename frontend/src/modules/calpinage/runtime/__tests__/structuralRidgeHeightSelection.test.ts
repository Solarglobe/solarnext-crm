import { describe, expect, it, afterEach } from "vitest";
import {
  readCalpinageRidgeEndpointHeightM,
  readCalpinageStructuralHeightM,
  resolveNearestStructuralHeightSelectionFromImagePx,
  resolveNearestStructuralHeightSelectionFromImagePxTsFallback,
  resolveNearestStructuralRidgeSelectionFromImagePx,
} from "../structuralRidgeHeightSelection";

describe("resolveNearestStructuralRidgeSelectionFromImagePx", () => {
  it("retourne l’extrémité de faîtage la plus proche dans la tolérance", () => {
    const runtime = {
      ridges: [
        { roofRole: "principal", a: { x: 100, y: 200, h: 6 }, b: { x: 300, y: 200, h: 7 } },
        { roofRole: "chienAssis", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      ],
    };
    const r = resolveNearestStructuralRidgeSelectionFromImagePx(runtime, { x: 102, y: 201 }, 10);
    expect(r).toEqual({ type: "ridge", index: 0, pointIndex: 0 });
  });

  it("ignore chienAssis pour l’index filtré", () => {
    const runtime = {
      ridges: [{ roofRole: "chienAssis", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, { roofRole: "x", a: { x: 50, y: 50 }, b: { x: 60, y: 50 } }],
    };
    const r = resolveNearestStructuralRidgeSelectionFromImagePx(runtime, { x: 50, y: 50 }, 5);
    expect(r?.index).toBe(0);
    expect(r?.pointIndex).toBe(0);
  });

  it("retourne null si trop loin", () => {
    const runtime = {
      ridges: [{ roofRole: "x", a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
    };
    expect(resolveNearestStructuralRidgeSelectionFromImagePx(runtime, { x: 500, y: 500 }, 5)).toBeNull();
  });
});

describe("resolveNearestStructuralHeightSelectionFromImagePx (TS fallback)", () => {
  it("priorise le contour sur le faîtage à distance strictement inférieure (ordre legacy)", () => {
    const runtime = {
      contours: [{ roofRole: "x", points: [{ x: 10, y: 10 }] }],
      ridges: [{ roofRole: "x", a: { x: 100, y: 100 }, b: { x: 101, y: 100 } }],
    };
    const r = resolveNearestStructuralHeightSelectionFromImagePxTsFallback(runtime, { x: 10, y: 10 }, 50);
    expect(r).toEqual({ type: "contour", index: 0, pointIndex: 0 });
  });

  it("résout un trait lorsque c’est le plus proche", () => {
    const runtime = {
      traits: [{ roofRole: "x", a: { x: 20, y: 20 }, b: { x: 40, y: 20 } }],
      ridges: [{ roofRole: "x", a: { x: 0, y: 0 }, b: { x: 5, y: 0 } }],
    };
    const r = resolveNearestStructuralHeightSelectionFromImagePxTsFallback(runtime, { x: 20, y: 20 }, 15);
    expect(r).toEqual({ type: "trait", index: 0, pointIndex: 0 });
  });
});

describe("resolveNearestStructuralHeightSelectionFromImagePx (délégation window)", () => {
  afterEach(() => {
    const w = window as unknown as { __calpinageResolveStructuralHeightSelectionNearImagePoint?: unknown };
    delete w.__calpinageResolveStructuralHeightSelectionNearImagePoint;
  });

  it("utilise le résolveur legacy quand il est exposé", () => {
    (window as unknown as { __calpinageResolveStructuralHeightSelectionNearImagePoint: (p: { x: number; y: number }, d: number) => unknown }).__calpinageResolveStructuralHeightSelectionNearImagePoint = () => ({
      type: "trait",
      index: 2,
      pointIndex: 1,
    });
    const r = resolveNearestStructuralHeightSelectionFromImagePx({}, { x: 1, y: 2 }, 10);
    expect(r).toEqual({ type: "trait", index: 2, pointIndex: 1 });
  });
});

describe("readCalpinageRidgeEndpointHeightM", () => {
  it("lit h sur l’extrémité", () => {
    const runtime = {
      ridges: [{ roofRole: "x", a: { x: 0, y: 0, h: 5.5 }, b: { x: 1, y: 1, h: 6.2 } }],
    };
    expect(
      readCalpinageRidgeEndpointHeightM(runtime, { type: "ridge", index: 0, pointIndex: 1 }, 99),
    ).toBe(6.2);
  });
});

describe("readCalpinageStructuralHeightM", () => {
  it("applique le défaut gouttière sur contour sans h", () => {
    const runtime = {
      contours: [{ roofRole: "x", points: [{ x: 0, y: 0 }] }],
    };
    expect(readCalpinageStructuralHeightM(runtime, { type: "contour", index: 0, pointIndex: 0 })).toBe(4);
  });

  it("applique le défaut gouttière sur trait sans h", () => {
    const runtime = {
      traits: [{ roofRole: "x", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }],
    };
    expect(readCalpinageStructuralHeightM(runtime, { type: "trait", index: 0, pointIndex: 0 })).toBe(4);
  });
});
