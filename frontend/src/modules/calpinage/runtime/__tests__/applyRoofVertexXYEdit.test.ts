import { describe, it, expect } from "vitest";
import { minimalCalpinageRuntimeFixture } from "../../canonical3d/dev/minimalCalpinageRuntimeFixture";
import {
  applyRoofVertexXYEdit,
  polygonPxRingSelfIntersects,
  validatePanPolygonPxSimple,
} from "../applyRoofVertexXYEdit";

function cloneRuntimeFixture() {
  return JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
}

describe("polygonPxRingSelfIntersects", () => {
  it("détecte le croisement des diagonales (quad « papillon »)", () => {
    expect(
      polygonPxRingSelfIntersects([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(true);
  });

  it("rectangle axis-aligné : pas de croisement", () => {
    expect(
      polygonPxRingSelfIntersects([
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ]),
    ).toBe(false);
  });
});

describe("applyRoofVertexXYEdit", () => {
  it("petit déplacement imagePx préserve la validité", () => {
    const runtime = cloneRuntimeFixture();
    const r = applyRoofVertexXYEdit(
      runtime,
      { panId: "pan-a", vertexIndex: 0, mode: "imagePx", xPx: 102, yPx: 101 },
      { maxDisplacementPx: 16 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clamped).toBe(false);
    const p0 = runtime.pans[0]!.polygonPx![0] as { x: number; y: number };
    expect(p0.x).toBe(102);
    expect(p0.y).toBe(101);
    const v = validatePanPolygonPxSimple(
      (runtime.pans[0]!.polygonPx as { x: number; y: number }[]).map((q) => ({ x: q.x, y: q.y })),
    );
    expect(v.ok).toBe(true);
  });

  it("delta monde → px (mpp=0.02, nord=0) équivalent au décalage horizontal", () => {
    const runtime = cloneRuntimeFixture();
    const r = applyRoofVertexXYEdit(
      runtime,
      { panId: "pan-a", vertexIndex: 0, mode: "deltaWorldM", dxM: 0.04, dyM: 0 },
      { maxDisplacementPx: 100 },
    );
    expect(r.ok).toBe(true);
    const p0 = runtime.pans[0]!.polygonPx![0] as { x: number; y: number };
    expect(p0.x).toBeCloseTo(102, 5);
    expect(p0.y).toBe(100);
  });

  it("rejette un déplacement qui annule l’aire (sommet sur arête opposée)", () => {
    const runtime = cloneRuntimeFixture();
    const before = JSON.stringify(runtime.pans[0]!.polygonPx);
    const r = applyRoofVertexXYEdit(
      runtime,
      { panId: "pan-a", vertexIndex: 0, mode: "imagePx", xPx: 200, yPx: 100 },
      { maxDisplacementPx: 500 },
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(runtime.pans[0]!.polygonPx)).toBe(before);
  });

  it("clamp si la cible dépasse maxDisplacementPx puis accepte si encore valide", () => {
    const runtime = cloneRuntimeFixture();
    const r = applyRoofVertexXYEdit(
      runtime,
      { panId: "pan-a", vertexIndex: 0, mode: "imagePx", xPx: 500, yPx: 500 },
      { maxDisplacementPx: 5 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.clamped).toBe(true);
    const p0 = runtime.pans[0]!.polygonPx![0] as { x: number; y: number };
    const dist = Math.hypot(p0.x - 100, p0.y - 100);
    expect(dist).toBeLessThanOrEqual(5.0001);
  });

  it("ne modifie pas les autres pans (pas de fusion)", () => {
    const runtime = cloneRuntimeFixture();
    (runtime as { pans: unknown[] }).pans = [
      runtime.pans[0],
      {
        id: "pan-b",
        polygonPx: [
          { x: 400, y: 400 },
          { x: 500, y: 400 },
          { x: 500, y: 500 },
        ],
      },
    ];
    const snapB = JSON.stringify((runtime.pans as { id: string; polygonPx: unknown[] }[])[1]!.polygonPx);
    expect(
      applyRoofVertexXYEdit(runtime, {
        panId: "pan-a",
        vertexIndex: 1,
        mode: "imagePx",
        xPx: 201,
        yPx: 100,
      }).ok,
    ).toBe(true);
    expect(JSON.stringify((runtime.pans as { id: string; polygonPx: unknown[] }[])[1]!.polygonPx)).toBe(snapB);
  });
});
