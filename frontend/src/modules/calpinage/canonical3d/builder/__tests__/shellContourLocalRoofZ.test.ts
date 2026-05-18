import { describe, expect, it } from "vitest";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import {
  closestPointOnPolygonBoundaryXY,
  resolveLocalRoofZAtXY,
  resolveRoofPlaneZAtXYFromPatches,
  resolveShellContourVertexWorldXYAndZ,
} from "../shellContourLocalRoofZ";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture : pan incliné 30° face sud
// ─────────────────────────────────────────────────────────────────────────────
//
// Convention axe : Y = nord, Z = vertical.
// Pan orienté plein sud, incliné à 30° de l'horizontale.
//
// Normale  : n = {0, -sin(30°), cos(30°)} = {0, -0.5, √3/2}  — normalisée ✓
//   |n|² = 0 + 0.25 + 0.75 = 1 ✓
// Équation plane (passant par l'origine) : n·p + d = 0, d = 0
//   → -0.5·y + (√3/2)·z = 0 → z = y / √3 = y·tan(30°)
//
// Coins monde (footprint [0,4]×[0,4] incliné) :
//   (0, 0, 0),  (4, 0, 0),  (4, 4, 4/√3),  (0, 4, 4/√3)
//
// Vérification que les coins sont sur le plan :
//   n·(4,4,4/√3) + 0 = -0.5·4 + (√3/2)·(4/√3) = -2 + 2 = 0 ✓
//
// Pente théorique : tan(30°) = 1/√3 ≈ 0.57735 m/m (Δz/Δy)
// ─────────────────────────────────────────────────────────────────────────────

const TAN_30 = Math.tan((30 * Math.PI) / 180); // 1/√3 ≈ 0.57735
const SQ3_2 = Math.sqrt(3) / 2;                // cos(30°) = √3/2

function south30DegPatch(id = "pan-30deg"): RoofPlanePatch3D {
  const normal = { x: 0, y: -0.5, z: SQ3_2 }; // sin30° = 0.5, cos30° = √3/2
  const d = 0;
  const sz = 4;
  const zTop = sz * TAN_30; // = 4/√3 ≈ 2.3094
  const cornersWorld = [
    { x: 0,  y: 0,  z: 0    },
    { x: sz, y: 0,  z: 0    },
    { x: sz, y: sz, z: zTop },
    { x: 0,  y: sz, z: zTop },
  ];
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["v1", "v2", "v3", "v4"],
    boundaryEdgeIds:   ["e1", "e2", "e3", "e4"],
    cornersWorld,
    localFrame: {
      role: "roof_face",
      origin: { ...cornersWorld[0]! },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: SQ3_2, z: 0.5 },  // axe montant de la pente (vers le faîtage)
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d },
    boundaryCycleWinding: "unspecified",
    centroid: { x: sz / 2, y: sz / 2, z: zTop / 2 },
    surface: {
      areaM2: sz * sz / Math.cos((30 * Math.PI) / 180), // surface inclinée
      projectedHorizontalAreaM2: sz * sz,
    },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:30deg" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

/** Carré [0,2]×[0,2] avec z = x (plan incliné) — point (3,1) hors emprise : extrapolation ancienne donnait z≈3. */
function slopedPanZEqualsXOn2mSquare(): RoofPlanePatch3D {
  const nl = Math.SQRT2;
  const normal = { x: -1 / nl, y: 0, z: 1 / nl };
  const cornersWorld = [
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 2 },
    { x: 2, y: 2, z: 2 },
    { x: 0, y: 2, z: 0 },
  ];
  return {
    id: "slope-z-eq-x",
    topologyRole: "primary_shell",
    boundaryVertexIds: ["a", "b", "c", "d"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld,
    localFrame: {
      role: "roof_face",
      origin: { ...cornersWorld[0]! },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: 0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 1, y: 1, z: 1 },
    surface: { areaM2: 8, projectedHorizontalAreaM2: 4 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests pan 30° — anti-régression bug C2
// ─────────────────────────────────────────────────────────────────────────────
//
// Ces tests vérifient que Z est calculé depuis l'équation du plan (z = -(a·x + b·y + d) / c)
// et NON depuis heightInterpolator (qui donnerait l'altitude sol IGN).
// Pour un pan incliné à 30°, l'erreur d'un heightInterpolator serait de l'ordre de plusieurs mètres.
//
// Modèle : z(x, y) = y · tan(30°) = y / √3
//
// Référence de tolérance numérique : 1e-5 m (< 0.01 mm — bien en dessous du seuil PV).

describe("shellContourLocalRoofZ — pan incliné 30° (bug C2 anti-régression)", () => {
  // ── Pente : Δz/Δy = tan(30°) ──────────────────────────────────────────────

  it("pente Δz/Δy = tan(30°) sur l'axe Y (direction de pente)", () => {
    const patch = south30DegPatch();
    const z1 = resolveRoofPlaneZAtXYFromPatches([patch], 2, 1);
    const z2 = resolveRoofPlaneZAtXYFromPatches([patch], 2, 3);
    expect(z1).not.toBeNull();
    expect(z2).not.toBeNull();
    // Δz / Δy doit valoir tan(30°) = 1/√3
    const slope = (z2! - z1!) / (3 - 1);
    expect(slope).toBeCloseTo(TAN_30, 5);
  });

  it("pente nulle sur l'axe X (direction de faîtage)", () => {
    const patch = south30DegPatch();
    const z1 = resolveRoofPlaneZAtXYFromPatches([patch], 1, 2);
    const z2 = resolveRoofPlaneZAtXYFromPatches([patch], 3, 2);
    expect(z1).not.toBeNull();
    expect(z2).not.toBeNull();
    // Δz / Δx = 0 (le pan n'est pas incliné dans la direction x)
    expect(z2! - z1!).toBeCloseTo(0, 5);
  });

  // ── Valeurs absolues en points intérieurs ─────────────────────────────────

  it("coin bas-sud (0, 0) : z = 0", () => {
    const z = resolveRoofPlaneZAtXYFromPatches([south30DegPatch()], 0, 0);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(0, 5);
  });

  it("centre (2, 2) : z = 2·tan(30°) ≈ 1.1547 m", () => {
    const z = resolveRoofPlaneZAtXYFromPatches([south30DegPatch()], 2, 2);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(2 * TAN_30, 5); // 2/√3 ≈ 1.15470
  });

  it("faîtage (2, 4) : z = 4·tan(30°) ≈ 2.3094 m (coin supérieur)", () => {
    const z = resolveRoofPlaneZAtXYFromPatches([south30DegPatch()], 2, 4);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(4 * TAN_30, 5); // 4/√3 ≈ 2.30940
  });

  it("point intérieur quelconque (1, 3) : z = 3·tan(30°) ≈ 1.7321 m", () => {
    const z = resolveRoofPlaneZAtXYFromPatches([south30DegPatch()], 1, 3);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(3 * TAN_30, 5); // 3/√3 = √3 ≈ 1.73205
  });

  // ── Hors emprise — fallback plan (extrapolation, pas heightInterpolator) ──

  it("hors emprise (2, 6) : z extrapolé = 6·tan(30°) — via plan du patch le plus proche", () => {
    // resolveRoofPlaneZAtXYFromPatches extrapole au (x,y) query — pas de snap
    const z = resolveRoofPlaneZAtXYFromPatches([south30DegPatch()], 2, 6);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(6 * TAN_30, 5); // 6/√3 ≈ 3.46410
  });

  it("hors emprise (2, -1) côté gouttière : z = -1·tan(30°) (extrapolation en dessous du ré-entrant)", () => {
    const z = resolveRoofPlaneZAtXYFromPatches([south30DegPatch()], 2, -1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(-1 * TAN_30, 5); // ≈ -0.57735
  });

  // ── resolveShellContourVertexWorldXYAndZ — mode shell (snap bord) ─────────

  it("resolveShellContourVertexWorldXYAndZ : (2, 6) hors emprise → XY snappé à (2, 4), z = 4·tan(30°)", () => {
    const r = resolveShellContourVertexWorldXYAndZ([south30DegPatch()], 2, 6);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(2, 5);
    expect(r!.y).toBeCloseTo(4, 5); // bord supérieur de l'emprise
    expect(r!.z).toBeCloseTo(4 * TAN_30, 5); // z au bord snappé, pas extrapolé
  });

  it("resolveShellContourVertexWorldXYAndZ : (2, -2) hors emprise → snappé au bord y=0, z = 0", () => {
    const r = resolveShellContourVertexWorldXYAndZ([south30DegPatch()], 2, -2);
    expect(r).not.toBeNull();
    expect(r!.y).toBeCloseTo(0, 5);
    expect(r!.z).toBeCloseTo(0, 5);
  });

  // ── Résolution Z via resolveLocalRoofZAtXY (alias public) ─────────────────

  it("resolveLocalRoofZAtXY délègue à resolveRoofPlaneZAtXYFromPatches : même résultat (2, 2)", () => {
    const patch = south30DegPatch();
    const z1 = resolveLocalRoofZAtXY([patch], 2, 2);
    const z2 = resolveRoofPlaneZAtXYFromPatches([patch], 2, 2);
    expect(z1).not.toBeNull();
    expect(z2).not.toBeNull();
    expect(z1!).toBeCloseTo(z2!, 10);
  });
});

describe("shellContourLocalRoofZ — Phase A4 hors emprise", () => {
  it("closestPointOnPolygonBoundaryXY : point extérieur → projeté sur le bord", () => {
    const c = closestPointOnPolygonBoundaryXY(3, 1, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(c).not.toBeNull();
    expect(c!.x).toBeCloseTo(2, 8);
    expect(c!.y).toBeCloseTo(1, 8);
  });

  it("hors emprise : Z = plan du patch au (x,y) query (pas snap bord) — ici z = x sur le plan", () => {
    const p = slopedPanZEqualsXOn2mSquare();
    const z = resolveLocalRoofZAtXY([p], 3, 1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(3, 5);
  });

  it("resolveShellContourVertexWorldXYAndZ : hors emprise → XY recalés sur le bord (cohérence shell/toiture)", () => {
    const p = slopedPanZEqualsXOn2mSquare();
    const r = resolveShellContourVertexWorldXYAndZ([p], 3, 1);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(2, 5);
    expect(r!.y).toBeCloseTo(1, 5);
    expect(r!.z).toBeCloseTo(2, 5);
  });

  it("dans l’empreinte : inchangé (plan au point query)", () => {
    const p = slopedPanZEqualsXOn2mSquare();
    const z = resolveLocalRoofZAtXY([p], 1, 1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(1, 5);
  });

  it("pan horizontal : hors emprise mais proche du bord → Z cohérent avec le bord", () => {
    const flat = makeHorizontalSquarePatch("flat", 2, 1.5);
    const z = resolveLocalRoofZAtXY([flat], 2.5, 0.5);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(1.5, 5);
  });

  it("hors emprise lointaine : fallback = plan du patch le plus proche en XY, Z au (x,y) query", () => {
    const flat = makeHorizontalSquarePatch("far", 2, 0);
    const z = resolveLocalRoofZAtXY([flat], 120, 0);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(0, 5);
  });

  it("resolveRoofPlaneZAtXYFromPatches : bord d’empreinte inclus → Z = plan au (x,y) exact", () => {
    const flat = makeHorizontalSquarePatch("flat", 2, 1.5);
    const z = resolveRoofPlaneZAtXYFromPatches([flat], 2, 1);
    expect(z).not.toBeNull();
    expect(z!).toBeCloseTo(1.5, 5);
  });
});
