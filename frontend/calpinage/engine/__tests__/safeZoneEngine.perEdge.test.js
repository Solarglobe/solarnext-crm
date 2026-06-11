import { describe, expect, it } from "vitest";
import { computeSafeZones, polygonAreaAbs } from "@shared/geometry/safeZoneEngine.js";

/**
 * SAFE-ZONE-V2 — tests golden du mode marges par arete (bandes keepout).
 * Pan de reference : carre 100x100, sommets CCW depuis (0,0).
 * Aretes (polygone ouvert) : 0=(0,0)->(100,0) bas ; 1=(100,0)->(100,100) droite ;
 * 2=(100,100)->(0,100) haut ; 3=(0,100)->(0,0) gauche.
 */

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function bbox(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function totalArea(result, panId) {
  return result.byPanId[panId].stats.totalAreaPx2;
}

describe("safeZoneEngine v2 — marges par arete", () => {
  it("retrocompat : sans donnees v2, inset uniforme historique inchange", () => {
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: SQUARE }],
      obstacles: [],
      marginPxOverride: 10,
    });
    const z = r.byPanId.p;
    expect(z.stats.mode).toBe("uniform_inset");
    expect(z.safeZonePolygonsPx.length).toBe(1);
    expect(totalArea(r, "p")).toBeCloseTo(6400, 0);
    const b = bbox(z.safeZonePolygonsPx);
    expect(b.minX).toBeCloseTo(10, 1);
    expect(b.maxX).toBeCloseTo(90, 1);
  });

  it("v2 uniforme : edgeMarginsPx [10,10,10,10] equivaut a l'inset 10", () => {
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: SQUARE, edgeMarginsPx: [10, 10, 10, 10] }],
      obstacles: [],
      marginPxOverride: 0,
    });
    const z = r.byPanId.p;
    expect(z.stats.mode).toBe("per_edge_bands");
    expect(z.stats.keepoutBandCount).toBeGreaterThan(0);
    expect(totalArea(r, "p")).toBeCloseTo(6400, 0);
    const b = bbox(z.safeZonePolygonsPx);
    expect(b.minX).toBeCloseTo(10, 1);
    expect(b.minY).toBeCloseTo(10, 1);
    expect(b.maxX).toBeCloseTo(90, 1);
    expect(b.maxY).toBeCloseTo(90, 1);
  });

  it("v2 differencie : marge 30 sur l'arete bas, 10 ailleurs", () => {
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: SQUARE, edgeMarginsPx: [30, 10, 10, 10] }],
      obstacles: [],
      marginPxOverride: 0,
    });
    const z = r.byPanId.p;
    expect(totalArea(r, "p")).toBeCloseTo(4800, 0);
    const b = bbox(z.safeZonePolygonsPx);
    expect(b.minY).toBeCloseTo(30, 1);
    expect(b.maxY).toBeCloseTo(90, 1);
    expect(b.minX).toBeCloseTo(10, 1);
    expect(b.maxX).toBeCloseTo(90, 1);
  });

  it("v2 : marge 0 sur une arete = pose au ras de cette arete", () => {
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: SQUARE, edgeMarginsPx: [0, 10, 10, 10] }],
      obstacles: [],
      marginPxOverride: 0,
    });
    expect(totalArea(r, "p")).toBeCloseTo(7200, 0);
    expect(bbox(r.byPanId.p.safeZonePolygonsPx).minY).toBeCloseTo(0, 1);
  });

  it("v2 : index manquant -> fallback marge uniforme (marginPxOverride)", () => {
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: SQUARE, edgeMarginsPx: [30] }],
      obstacles: [],
      marginPxOverride: 10,
    });
    expect(totalArea(r, "p")).toBeCloseTo(4800, 0);
    expect(bbox(r.byPanId.p.safeZonePolygonsPx).minY).toBeCloseTo(30, 1);
  });

  it("v2 : polygone ferme (point duplique) -> meme indexation des aretes", () => {
    const closed = [...SQUARE, { x: 0, y: 0 }];
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: closed, edgeMarginsPx: [30, 10, 10, 10] }],
      obstacles: [],
      marginPxOverride: 0,
    });
    expect(totalArea(r, "p")).toBeCloseTo(4800, 0);
    expect(bbox(r.byPanId.p.safeZonePolygonsPx).minY).toBeCloseTo(30, 1);
  });

  it("v2 : faitage/arete STRICTEMENT INTERIEUR au pan coupe la safe zone en deux", () => {
    const r = computeSafeZones({
      pans: [{
        id: "p",
        polygonPx: SQUARE,
        edgeMarginsPx: [10, 10, 10, 10],
        structuralSegmentsPx: [{ a: { x: 50, y: 0 }, b: { x: 50, y: 100 }, marginPx: 10 }],
      }],
      obstacles: [],
      marginPxOverride: 0,
    });
    const z = r.byPanId.p;
    expect(z.safeZonePolygonsPx.length).toBe(2);
    expect(totalArea(r, "p")).toBeCloseTo(4800, 0);
    const areas = z.safeZonePolygonsPx.map((poly) => polygonAreaAbs(poly)).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(2400, 0);
    expect(areas[1]).toBeCloseTo(2400, 0);
  });

  it("v2 : structuralSegmentsPx accepte marginCm via cmToPxFn", () => {
    const r = computeSafeZones({
      pans: [{
        id: "p",
        polygonPx: SQUARE,
        edgeMarginsPx: [0, 0, 0, 0],
        structuralSegmentsPx: [{ a: { x: 50, y: 0 }, b: { x: 50, y: 100 }, marginCm: 1000 }],
      }],
      obstacles: [],
      marginOuterCm: 0,
      cmToPxFn: (cm) => cm / 100, // 1000 cm -> 10 px
    });
    expect(totalArea(r, "p")).toBeCloseTo(10000 - 20 * 100, 0);
  });

  it("v2 : obstacleMarginPx dilate les obstacles independamment des aretes", () => {
    const r = computeSafeZones({
      pans: [{
        id: "p",
        polygonPx: SQUARE,
        edgeMarginsPx: [0, 0, 0, 0],
        obstacleMarginPx: 5,
      }],
      obstacles: [{
        id: "o",
        polygonPx: [
          { x: 45, y: 45 },
          { x: 55, y: 45 },
          { x: 55, y: 55 },
          { x: 45, y: 55 },
        ],
      }],
      marginPxOverride: 0,
    });
    // trou attendu : obstacle 10x10 dilate de 5 (jtMiter) -> 20x20 = 400
    expect(totalArea(r, "p")).toBeCloseTo(9600, 0);
  });

  it("v2 : pan trapezoidal — la safe zone suit les aretes inclinees", () => {
    const trap = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 80, y: 60 },
      { x: 20, y: 60 },
    ];
    const r = computeSafeZones({
      pans: [{ id: "p", polygonPx: trap, edgeMarginsPx: [10, 10, 10, 10] }],
      obstacles: [],
      marginPxOverride: 0,
    });
    const z = r.byPanId.p;
    expect(z.safeZonePolygonsPx.length).toBe(1);
    const areaTrap = polygonAreaAbs(trap);
    expect(totalArea(r, "p")).toBeGreaterThan(0);
    expect(totalArea(r, "p")).toBeLessThan(areaTrap);
    // toutes les aretes du resultat restent dans la bbox interieure
    const b = bbox(z.safeZonePolygonsPx);
    expect(b.minY).toBeCloseTo(10, 1);
    expect(b.maxY).toBeCloseTo(50, 1);
  });
});
