/**
 * Tests : fanTriangulateVertexIndexCycle vs earcutTriangulateVertexIndexCycle.
 *
 * Cas validés :
 *  - Triangle (n=3) : résultat identique pour les deux
 *  - Carré convexe : les deux produisent n-2 = 2 triangles
 *  - Obstacle en L (concave, 6 sommets) :
 *      fan  → 4 triangles dont AU MOINS UN traverse la concavité (diagonale invalide 0→3)
 *      earcut → 4 triangles sans diagonale invalide
 */

import { describe, expect, it } from "vitest";
import type { Vector3 } from "../../types/primitives";
import {
  earcutTriangulateVertexIndexCycle,
  fanTriangulateVertexIndexCycle,
} from "../triangulateFace";

// ---------------------------------------------------------------------------
// Helpers de test
// ---------------------------------------------------------------------------

/** Retourne true si le triplet [a,b,c] contient à la fois les indices ix et iy (diagonale ix–iy). */
function triHasDiagonal(tri: [number, number, number], ix: number, iy: number): boolean {
  return tri.includes(ix) && tri.includes(iy);
}

/** Vérifie qu'une triangulation couvre exactement n-2 triangles pour un polygone à n sommets. */
function expectTriCount(tris: [number, number, number][], n: number): void {
  expect(tris.length).toBe(n - 2);
}

// ---------------------------------------------------------------------------
// Cas de base
// ---------------------------------------------------------------------------

describe("fanTriangulateVertexIndexCycle", () => {
  it("triangle (n=3)", () => {
    expect(fanTriangulateVertexIndexCycle([7, 2, 5])).toEqual([[7, 2, 5]]);
  });

  it("carré convexe → 2 triangles", () => {
    const tris = fanTriangulateVertexIndexCycle([0, 1, 2, 3]);
    expectTriCount(tris, 4);
    // Tous les triangles partagent le sommet pivot 0
    expect(tris.every((t) => t[0] === 0)).toBe(true);
  });

  it("polygone en L → 4 triangles DONT un traverse la concavité (diagonale 0→3)", () => {
    // L-shape CCW (voir commentaire earcutTriangulateVertexIndexCycle.test.ts)
    const cycle = [0, 1, 2, 3, 4, 5];
    const tris = fanTriangulateVertexIndexCycle(cycle);
    expectTriCount(tris, 6);

    // Le fan depuis l'indice 0 produit nécessairement le triplet [0,3,4]
    // dont la diagonale 0→3 sort du polygone (voir doc triangulateFace.ts).
    const hasBadDiag = tris.some((t) => triHasDiagonal(t, 0, 3));
    expect(hasBadDiag).toBe(true); // confirme le bug fan sur les concaves
  });
});

// ---------------------------------------------------------------------------
// Obstacle en L — cas de référence pour l'ear-clipping
// ---------------------------------------------------------------------------

/**
 * L-shape à plat dans le plan XY (z=0), orientation CCW :
 *
 *   V5(0,2) ──── V4(2,2)
 *      |              |
 *      |         V3(2,1)──V2(1,1)
 *      |                      |
 *   V0(0,0) ──────────────V1(1,0)
 *
 * La "concavité" est le carré supérieur-droit [1..2]×[0..1] qui appartient
 * à l'intérieur de la bounding box mais PAS au polygone.
 *
 * La diagonale invalide dans le fan est 0→3 : le segment de (0,0) à (2,1)
 * passe par (1.5, 0.75) qui est EN DEHORS du L.
 */
function makeLShapePositions(): Vector3[] {
  return [
    { x: 0, y: 0, z: 0 }, // V0
    { x: 1, y: 0, z: 0 }, // V1
    { x: 1, y: 1, z: 0 }, // V2
    { x: 2, y: 1, z: 0 }, // V3
    { x: 2, y: 2, z: 0 }, // V4
    { x: 0, y: 2, z: 0 }, // V5
  ];
}

describe("earcutTriangulateVertexIndexCycle", () => {
  it("triangle (n=3) — identique au fan", () => {
    const positions: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    expect(earcutTriangulateVertexIndexCycle([0, 1, 2], positions)).toEqual([[0, 1, 2]]);
  });

  it("carré convexe → 2 triangles", () => {
    const positions: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    const tris = earcutTriangulateVertexIndexCycle([0, 1, 2, 3], positions);
    expectTriCount(tris, 4);
    // Tous les indices sont dans [0,3]
    expect(tris.flat().every((i) => i >= 0 && i <= 3)).toBe(true);
  });

  it("polygone en L (6 sommets) → 4 triangles sans diagonale invalide 0→3", () => {
    const positions = makeLShapePositions();
    const cycle = [0, 1, 2, 3, 4, 5];
    const tris = earcutTriangulateVertexIndexCycle(cycle, positions);

    // Nombre correct de triangles
    expectTriCount(tris, 6);

    // Aucun triangle ne doit contenir la diagonale 0→3
    const hasBadDiag = tris.some((t) => triHasDiagonal(t, 0, 3));
    expect(hasBadDiag).toBe(false);
  });

  it("polygone en L — indices non consécutifs (cycle offset)", () => {
    // Les indices globaux sont décalés de 10 (comme dans un vrai volume)
    const basePositions = makeLShapePositions();
    const positions: Vector3[] = [
      // indices 0..9 de remplissage
      ...Array.from({ length: 10 }, () => ({ x: 99, y: 99, z: 99 })),
      ...basePositions, // indices 10..15
    ];
    const cycle = [10, 11, 12, 13, 14, 15];
    const tris = earcutTriangulateVertexIndexCycle(cycle, positions);

    expectTriCount(tris, 6);
    // Aucun triangle avec la diagonale invalide 10→13
    const hasBadDiag = tris.some((t) => triHasDiagonal(t, 10, 13));
    expect(hasBadDiag).toBe(false);
  });

  it("face verticale (obstacle-mur) dans le plan XZ → projection correcte", () => {
    // Face dans le plan Y=0 (normale Y) : projection sur XZ
    const positions: Vector3[] = [
      { x: 0, y: 0, z: 0 }, // V0
      { x: 2, y: 0, z: 0 }, // V1
      { x: 2, y: 0, z: 2 }, // V2
      { x: 0, y: 0, z: 2 }, // V3
    ];
    const tris = earcutTriangulateVertexIndexCycle([0, 1, 2, 3], positions);
    expectTriCount(tris, 4);
  });

  it("polygone dégénéré (< 3 sommets) → tableau vide", () => {
    const positions: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
    expect(earcutTriangulateVertexIndexCycle([0, 1], positions)).toEqual([]);
  });
});
