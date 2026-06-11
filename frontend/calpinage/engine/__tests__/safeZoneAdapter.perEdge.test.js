import { describe, expect, it } from "vitest";
import {
  computeSafeZonesFromCalpinageState,
  classifyPanEdgesV2,
  completeMargesCm,
  marginCmForRole,
  sanitizeMargesCmPartial,
} from "../safeZoneAdapter.js";
import { polygonAreaAbs } from "@shared/geometry/safeZoneEngine.js";

/**
 * SAFE-ZONE-V2 — tests adaptateur : classification des roles d'aretes + marges par type.
 * mpp = 0.01 m/px -> cmToPx = (cm/100)/0.01 = cm : 1 cm = 1 px (lecture directe).
 */

const MPP = 0.01;

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

// Faitage = arete haute du pan (y=100)
const RIDGE_TOP = { id: "r1", a: { x: 0, y: 100 }, b: { x: 100, y: 100 } };

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

describe("safeZoneAdapter v2 — classification des aretes", () => {
  it("identifie faitage (segment structurel) / egout (parallele) / rives (perpendiculaires)", () => {
    const cls = classifyPanEdgesV2(SQUARE, [
      { a: RIDGE_TOP.a, b: RIDGE_TOP.b, role: "faitage" },
    ]);
    // aretes : 0 = bas (0,0)->(100,0) ; 1 = droite ; 2 = haut (faitage) ; 3 = gauche
    expect(cls.roles[2]).toBe("faitage");
    expect(cls.roles[0]).toBe("egout");
    expect(cls.roles[1]).toBe("rive");
    expect(cls.roles[3]).toBe("rive");
  });

  it("sans faitage de reference, les aretes contour sont 'bord'", () => {
    const cls = classifyPanEdgesV2(SQUARE, []);
    expect(cls.roles).toEqual(["bord", "bord", "bord", "bord"]);
  });

  it("marginCmForRole('bord') = max(egout, rive)", () => {
    const m = completeMargesCm(sanitizeMargesCmPartial({ egoutCm: 20, riveCm: 80 }), 0);
    expect(marginCmForRole("bord", m)).toBe(80);
  });
});

describe("safeZoneAdapter v2 — safe zone avec marges par type", () => {
  it("applique faitage 40 / egout 20 / rive 10 sur un pan carre", () => {
    const r = computeSafeZonesFromCalpinageState({
      pans: [{ id: "p", polygonPx: SQUARE }],
      obstacles: [],
      ridges: [RIDGE_TOP],
      traits: [],
      margesCm: { faitageCm: 40, aretierCm: 30, egoutCm: 20, riveCm: 10, obstacleCm: 0 },
      marginOuterCm: 20,
      metersPerPixel: MPP,
    });
    const z = r.byPanId.p;
    expect(z.stats.mode).toBe("per_edge_bands");
    const b = bbox(z.safeZonePolygonsPx);
    expect(b.minX).toBeCloseTo(10, 1); // rive gauche
    expect(b.maxX).toBeCloseTo(90, 1); // rive droite
    expect(b.minY).toBeCloseTo(20, 1); // egout
    expect(b.maxY).toBeCloseTo(60, 1); // faitage 40
    expect(z.stats.totalAreaPx2).toBeCloseTo(80 * 40, 0);
  });

  it("une arete (trait) INTERIEURE au pan coupe la zone avec la marge aretier", () => {
    const r = computeSafeZonesFromCalpinageState({
      pans: [{ id: "p", polygonPx: SQUARE }],
      obstacles: [],
      ridges: [RIDGE_TOP],
      traits: [{ id: "t1", a: { x: 50, y: 20 }, b: { x: 50, y: 80 } }],
      margesCm: { faitageCm: 40, aretierCm: 10, egoutCm: 20, riveCm: 10, obstacleCm: 0 },
      marginOuterCm: 20,
      metersPerPixel: MPP,
    });
    const z = r.byPanId.p;
    expect(z.safeZonePolygonsPx.length).toBe(2);
    const areas = z.safeZonePolygonsPx.map((p) => polygonAreaAbs(p)).sort((a, b2) => a - b2);
    // zone = [10,90]x[20,60] moins bande x∈[40,60] -> deux rects 30x40 = 1200
    expect(areas[0]).toBeGreaterThan(1180);
    expect(areas[0]).toBeLessThan(1220);
    expect(areas[1]).toBeGreaterThan(1180);
    expect(areas[1]).toBeLessThan(1220);
  });

  it("override par pan : pan.margesCm prime sur le global", () => {
    const r = computeSafeZonesFromCalpinageState({
      pans: [{ id: "p", polygonPx: SQUARE, margesCm: { faitageCm: 10 } }],
      obstacles: [],
      ridges: [RIDGE_TOP],
      traits: [],
      margesCm: { faitageCm: 40, aretierCm: 30, egoutCm: 20, riveCm: 10, obstacleCm: 0 },
      marginOuterCm: 20,
      metersPerPixel: MPP,
    });
    const b = bbox(r.byPanId.p.safeZonePolygonsPx);
    expect(b.maxY).toBeCloseTo(90, 1); // faitage 10 au lieu de 40
  });

  it("marge obstacle independante (obstacleCm)", () => {
    const r = computeSafeZonesFromCalpinageState({
      pans: [{ id: "p", polygonPx: SQUARE }],
      obstacles: [{
        id: "o",
        polygonPx: [
          { x: 45, y: 45 },
          { x: 55, y: 45 },
          { x: 55, y: 55 },
          { x: 45, y: 55 },
        ],
      }],
      ridges: [RIDGE_TOP],
      traits: [],
      margesCm: { faitageCm: 0, aretierCm: 0, egoutCm: 0, riveCm: 0, obstacleCm: 5 },
      marginOuterCm: 20,
      metersPerPixel: MPP,
    });
    // pan entier moins obstacle 10x10 dilate de 5 -> 20x20
    expect(r.byPanId.p.stats.totalAreaPx2).toBeCloseTo(10000 - 400, 0);
  });

  it("sans opts.margesCm : comportement historique strictement inchange", () => {
    const r = computeSafeZonesFromCalpinageState({
      pans: [{ id: "p", polygonPx: SQUARE }],
      obstacles: [],
      marginOuterCm: 10,
      metersPerPixel: MPP,
    });
    const z = r.byPanId.p;
    expect(z.stats.mode).toBe("uniform_inset");
    expect(z.stats.totalAreaPx2).toBeCloseTo(80 * 80, 0);
  });

  it("pan FLAT : ignore margesCm, garde les setbacks dedies", () => {
    const r = computeSafeZonesFromCalpinageState({
      pans: [{
        id: "p",
        polygonPx: SQUARE,
        roofType: "FLAT",
        flatRoofConfig: { setbackRoofEdgeCm: 10, setbackObstacleCm: 10 },
      }],
      obstacles: [],
      ridges: [RIDGE_TOP],
      traits: [],
      margesCm: { faitageCm: 40, aretierCm: 30, egoutCm: 20, riveCm: 10, obstacleCm: 0 },
      marginOuterCm: 20,
      metersPerPixel: MPP,
    });
    const z = r.byPanId.p;
    expect(z.stats.mode).toBe("uniform_inset");
    expect(z.stats.totalAreaPx2).toBeCloseTo(80 * 80, 0);
  });
});
