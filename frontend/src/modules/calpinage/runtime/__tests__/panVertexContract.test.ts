import { describe, expect, it } from "vitest";
import {
  computePanPhysicsDiagnostics,
  ensurePanPointsCanonicalFromGeometry,
  readPanVertexRing,
  savedPanVertexRingCompatibleWithPolygon,
} from "../panVertexContract";

describe("panVertexContract", () => {
  it("readPanVertexRing : ordre points > polygonPx > polygon", () => {
    const onlyPoly = { id: "a", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
    expect(readPanVertexRing(onlyPoly).length).toBe(3);

    const pxOnly = {
      id: "b",
      polygonPx: [
        { x: 10, y: 10, h: 5 },
        { x: 20, y: 10 },
        { x: 15, y: 20 },
      ],
    };
    const r = readPanVertexRing(pxOnly);
    expect(r.length).toBe(3);
    expect(r[0].h).toBe(5);

    const pointsWin = {
      id: "c",
      points: [
        { x: 0, y: 0, h: 1 },
        { x: 2, y: 0 },
        { x: 1, y: 2 },
      ],
      polygonPx: [{ x: 99, y: 99 }, { x: 100, y: 99 }, { x: 99, y: 100 }],
    };
    const rw = readPanVertexRing(pointsWin);
    expect(rw[0].h).toBe(1);
    expect(rw[0].x).toBe(0);
  });

  it("savedPanVertexRingCompatibleWithPolygon : même longueur et XY proches", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ];
    const savedOk = [
      { x: 0.5, y: 0, h: 4 },
      { x: 10, y: 0.5, h: 6 },
      { x: 5, y: 8, h: 5 },
    ];
    expect(savedPanVertexRingCompatibleWithPolygon(savedOk, poly, 1)).toBe(true);
    expect(savedPanVertexRingCompatibleWithPolygon([{ x: 0, y: 0 }], poly)).toBe(false);
  });

  it("ensurePanPointsCanonicalFromGeometry : points obsolètes vs polygon → repart du polygon", () => {
    const pan: Record<string, unknown> = {
      id: "p-rebuild",
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 80 },
      ],
      points: [
        { x: 0, y: 0, h: 4 },
        { x: 1, y: 0, h: 5 },
        { x: 0, y: 1, h: 6 },
      ],
    };
    expect(ensurePanPointsCanonicalFromGeometry(pan)).toBe(true);
    const pts = pan.points as { x: number; y: number; h?: number }[];
    expect(pts[0].x).toBe(0);
    expect(pts[1].x).toBe(100);
    expect(pts[2].y).toBe(80);
    expect(pts[0].h).toBeUndefined();
  });

  it("ensurePanPointsCanonicalFromGeometry remplit points depuis polygonPx", () => {
    const pan: Record<string, unknown> = {
      id: "p1",
      polygonPx: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 1.5, y: 2 },
      ],
    };
    expect(ensurePanPointsCanonicalFromGeometry(pan)).toBe(true);
    expect(Array.isArray(pan.points)).toBe(true);
    expect((pan.points as { x: number }[]).length).toBe(3);
    expect((pan.points as { x: number }[])[0].x).toBe(0);
  });

  it("computePanPhysicsDiagnostics compte les pans bloqués sans h", () => {
    const pans = [
      {
        id: "x",
        points: [
          { x: 0, y: 0, h: 4 },
          { x: 1, y: 0, h: 5 },
          { x: 0.5, y: 1, h: 4.5 },
        ],
        physical: {
          slope: { computedDeg: 12 },
          orientation: { azimuthDeg: 180 },
        },
      },
      {
        id: "y",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ];
    const d = computePanPhysicsDiagnostics(pans);
    expect(d.panCount).toBe(2);
    expect(d.pansWithVertexRing).toBe(2);
    expect(d.pansWithAllHeightsResolved).toBe(1);
    expect(d.pansBlockedMissingHeights).toBe(1);
    expect(d.pansWithPhysicsSlope).toBe(1);
  });
});
