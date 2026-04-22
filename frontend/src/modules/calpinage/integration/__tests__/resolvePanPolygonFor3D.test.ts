import { describe, it, expect } from "vitest";
import { resolvePanPolygonFor3D } from "../resolvePanPolygonFor3D";

describe("resolvePanPolygonFor3D", () => {
  it("priorise polygonPx lorsque polygonPx et polygon diffèrent", () => {
    const px = [
      { x: 1, y: 1 },
      { x: 10, y: 1 },
      { x: 10, y: 10 },
      { x: 1, y: 10 },
    ];
    const polyOther = [
      { x: 99, y: 99 },
      { x: 100, y: 99 },
      { x: 100, y: 100 },
    ];
    const pan = { id: "p", polygonPx: px, polygon: polyOther };
    const r = resolvePanPolygonFor3D(pan);
    expect(r.source).toBe("polygonPx");
    expect(r.raw).toBe(px);
  });

  it("sans polygonPx mais avec points ≥3 → source points", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 2, y: 4 },
    ];
    const pan = { id: "p", points: pts };
    const r = resolvePanPolygonFor3D(pan);
    expect(r.source).toBe("points");
    expect(r.raw).toBe(pts);
  });

  it("sans polygonPx ni points : polygon seul ≥3 → source polygon", () => {
    const gon = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ];
    const pan = { id: "p", polygon: gon };
    const r = resolvePanPolygonFor3D(pan);
    expect(r.source).toBe("polygon");
    expect(r.raw).toBe(gon);
  });

  it("ultime repli : contour.points seul ≥3 → source contour.points", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const pan = { id: "p", contour: { points: ring } };
    const r = resolvePanPolygonFor3D(pan);
    expect(r.source).toBe("contour.points");
    expect(r.raw).toBe(ring);
  });

  it("retourne null si aucune source ≥3 sommets", () => {
    expect(resolvePanPolygonFor3D({ polygonPx: [{ x: 0, y: 0 }] }).raw).toBeNull();
    expect(resolvePanPolygonFor3D({}).raw).toBeNull();
  });
});
