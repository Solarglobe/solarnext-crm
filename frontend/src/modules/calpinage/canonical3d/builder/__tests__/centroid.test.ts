import { describe, expect, it } from "vitest";
import { getCentroid } from "../centroid";

// Tolérance numérique pour les assertions flottantes
const TOL = 1e-10;

describe("getCentroid — formule Shoelace", () => {
  // ── Cas limites ─────────────────────────────────────────────────────────────

  it("tableau vide → {0,0}", () => {
    expect(getCentroid([])).toEqual({ x: 0, y: 0 });
  });

  it("un seul sommet → ce sommet", () => {
    expect(getCentroid([{ x: 3, y: 7 }])).toEqual({ x: 3, y: 7 });
  });

  it("deux sommets → milieu du segment", () => {
    const c = getCentroid([{ x: 0, y: 0 }, { x: 4, y: 2 }]);
    expect(c.x).toBeCloseTo(2, 10);
    expect(c.y).toBeCloseTo(1, 10);
  });

  // ── Triangle équilatéral ────────────────────────────────────────────────────
  //
  // Sommets : (0,0), (6,0), (3, 3√3)
  // Centroïde exact = ((0+6+3)/3, (0+0+3√3)/3) = (3, √3)

  it("triangle équilatéral : centroïde = intersection des médianes", () => {
    const h = 3 * Math.sqrt(3);
    const c = getCentroid([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: h },
    ]);
    expect(c.x).toBeCloseTo(3, 10);
    expect(c.y).toBeCloseTo(Math.sqrt(3), 10);
  });

  // ── Carré axe-aligné ────────────────────────────────────────────────────────
  //
  // Sommets CCW : (0,0),(4,0),(4,4),(0,4)  → centroïde = (2,2)

  it("carré 4×4 CCW : centroïde = centre géométrique", () => {
    const c = getCentroid([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
    expect(c.x).toBeCloseTo(2, 10);
    expect(c.y).toBeCloseTo(2, 10);
  });

  it("carré 4×4 CW (ordre inversé) : même centroïde", () => {
    const c = getCentroid([
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(c.x).toBeCloseTo(2, 10);
    expect(c.y).toBeCloseTo(2, 10);
  });

  // ── Rectangle non centré ────────────────────────────────────────────────────

  it("rectangle [2,8]×[3,7] : centroïde = (5, 5)", () => {
    const c = getCentroid([
      { x: 2, y: 3 },
      { x: 8, y: 3 },
      { x: 8, y: 7 },
      { x: 2, y: 7 },
    ]);
    expect(c.x).toBeCloseTo(5, 10);
    expect(c.y).toBeCloseTo(5, 10);
  });

  // ── Polygone en L ──────────────────────────────────────────────────────────
  //
  //  Sommets CCW (repère standard Y↑) :
  //
  //    (0,0) → (4,0) → (4,2) → (2,2) → (2,4) → (0,4) → (0,0)
  //
  //  Deux rectangles :
  //    R1 : x∈[0,4], y∈[0,2]  → aire=8, centroïde=(2,1)
  //    R2 : x∈[0,2], y∈[2,4]  → aire=4, centroïde=(1,3)
  //
  //  Centroïde composite :
  //    Cx = (8·2 + 4·1) / 12 = 20/12 = 5/3
  //    Cy = (8·1 + 4·3) / 12 = 20/12 = 5/3
  //
  // La moyenne arithmétique des 6 sommets donnerait Cx=2, Cy=2 — incorrect.

  it("polygone en L : Shoelace donne le vrai centroïde pondéré par l'aire", () => {
    const c = getCentroid([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ]);
    expect(c.x).toBeCloseTo(5 / 3, 10);
    expect(c.y).toBeCloseTo(5 / 3, 10);
  });

  it("polygone en L : diffère de la moyenne arithmétique", () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const c = getCentroid(vertices);
    // Moyenne arithmétique
    const mx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length; // = 2
    const my = vertices.reduce((s, v) => s + v.y, 0) / vertices.length; // = 2
    // Le centroïde Shoelace doit différer de la moyenne
    expect(Math.abs(c.x - mx) + Math.abs(c.y - my)).toBeGreaterThan(TOL);
  });

  // ── Invariance par translation ───────────────────────────────────────────────

  it("invariance par translation : carré décalé de (100,200)", () => {
    const dx = 100;
    const dy = 200;
    const c = getCentroid([
      { x: dx + 0, y: dy + 0 },
      { x: dx + 4, y: dy + 0 },
      { x: dx + 4, y: dy + 4 },
      { x: dx + 0, y: dy + 4 },
    ]);
    expect(c.x).toBeCloseTo(dx + 2, 8);
    expect(c.y).toBeCloseTo(dy + 2, 8);
  });
});
