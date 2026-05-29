/**
 * Tests for readLayerSnap -- verifies that roofExtensions from CALPINAGE_STATE
 * are included in the layer snapshot (E14).
 *
 * readLayerSnap reads window.CALPINAGE_STATE and calls resolveImgH().
 * We mock both to avoid DOM/canvas dependencies.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock resolveImgH before importing the module under test.
vi.mock("../resolveImgH", () => ({
  resolveImgH: () => 800,
}));

import { readLayerSnap } from "../KonvaContoursLayer";

const W = window as unknown as Record<string, unknown>;

function setState(state: unknown) {
  W["CALPINAGE_STATE"] = state;
}

beforeEach(() => {
  delete W["CALPINAGE_STATE"];
});

afterEach(() => {
  delete W["CALPINAGE_STATE"];
});

describe("E14 -- readLayerSnap inclut roofExtensions", () => {
  it("retourne null si CALPINAGE_STATE absent", () => {
    expect(readLayerSnap()).toBeNull();
  });

  it("retourne un snap avec roofExtensions vide si absent de l'etat", () => {
    setState({ contours: [], ridges: [] });
    const snap = readLayerSnap();
    expect(snap).not.toBeNull();
    expect(snap!.roofExtensions).toEqual([]);
  });

  it("lit une extension avec contour, ridge et hips depuis state.roofExtensions", () => {
    const rx = {
      id: "rx-1",
      kind: "gable",
      contour: {
        points: [
          { x: 10, y: 20 },
          { x: 50, y: 20 },
          { x: 50, y: 60 },
          { x: 10, y: 60 },
        ],
        closed: true,
      },
      ridge: { a: { x: 10, y: 40 }, b: { x: 50, y: 40 } },
      hips: {
        left:  { a: { x: 10, y: 20 }, b: { x: 10, y: 40 } },
        right: { a: { x: 50, y: 20 }, b: { x: 50, y: 40 } },
      },
    };

    setState({ contours: [], ridges: [], roofExtensions: [rx] });

    const snap = readLayerSnap();
    expect(snap).not.toBeNull();
    expect(snap!.roofExtensions).toHaveLength(1);

    const ext = snap!.roofExtensions[0]!;
    expect(ext.id).toBe("rx-1");
    expect(ext.contour?.points).toHaveLength(4);
    expect(ext.ridge?.a.x).toBe(10);
    expect(ext.ridge?.b.x).toBe(50);
    expect(ext.hips?.left?.a.x).toBe(10);
    expect(ext.hips?.right?.b.x).toBe(50);
  });

  it("lit plusieurs extensions", () => {
    setState({
      contours: [],
      ridges: [],
      roofExtensions: [
        { id: "rx-a", contour: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], closed: true } },
        { id: "rx-b", contour: { points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 25, y: 10 }], closed: true } },
      ],
    });
    const snap = readLayerSnap();
    expect(snap!.roofExtensions).toHaveLength(2);
    expect(snap!.roofExtensions.map((r) => r.id)).toEqual(["rx-a", "rx-b"]);
  });

  it("imgH est fourni par resolveImgH (800 dans ce test)", () => {
    setState({ contours: [], ridges: [], roofExtensions: [] });
    const snap = readLayerSnap();
    expect(snap!.imgH).toBe(800);
  });

  it("contours et ridges existants sont toujours presentes dans le snap", () => {
    setState({
      contours: [
        { id: "c1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false, roofRole: "main" },
      ],
      ridges: [
        { id: "r1", a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, roofRole: "main" },
      ],
      roofExtensions: [{ id: "rx-1" }],
    });
    const snap = readLayerSnap();
    expect(snap!.contours).toHaveLength(1);
    expect(snap!.ridges).toHaveLength(1);
    expect(snap!.roofExtensions).toHaveLength(1);
  });
});
