/**
 * Décomposition d’un cycle de face en triangles.
 *
 * DEUX modes :
 *  - fanTriangulateVertexIndexCycle  : éventail O(n), correct pour convexes uniquement.
 *  - earcutTriangulateVertexIndexCycle : ear-clipping O(n²), correct pour tous polygones
 *    simples (convexes ET concaves). Remplace le fan dans le pipeline raycast.
 *
 * Pourquoi le fan est dangereux : un obstacle en L (ou U) a un sommet concave.
 * L’éventail depuis l’indice 0 produit des triangles dont les diagonales traversent
 * la concavité — la face couvre une zone fictive → rayons fantômes → ombres fausses.
 *
 * L’ear-clipping projette le cycle 3D sur son plan dominant (axe normal maximal)
 * puis triangule en 2D avec l’algorithme maison `triangulateSimplePolygon2dCcW`.
 * Fallback automatique sur le fan si la projection est dégénérée.
 */

import type { Vector3 } from "../types/primitives";
import { signedArea2d, triangulateSimplePolygon2dCcW } from "../../utils/triangulateSimplePolygon2d";

// ---------------------------------------------------------------------------
// Fan triangulation (convexes uniquement — maintenu pour compatibilité)
// ---------------------------------------------------------------------------

/** Retourne des triplets d’indices dans le cycle (références au tableau de sommets du volume). */
export function fanTriangulateVertexIndexCycle(cycle: readonly number[]): [number, number, number][] {
  const n = cycle.length;
  if (n < 3) return [];
  if (n === 3) {
    return [[cycle[0]!, cycle[1]!, cycle[2]!]];
  }
  const tris: [number, number, number][] = [];
  const i0 = cycle[0]!;
  for (let k = 1; k < n - 1; k++) {
    tris.push([i0, cycle[k]!, cycle[k + 1]!]);
  }
  return tris;
}

// ---------------------------------------------------------------------------
// Ear-clipping — correct pour convexes ET concaves
// ---------------------------------------------------------------------------

/**
 * Projette les positions 3D du cycle sur le plan le mieux aligné avec la normale de la face.
 * Inverse l’ordre si le polygone est CW (triangulateSimplePolygon2dCcW exige CCW).
 *
 * Retourne { pts2d, cycleOrdered } où cycleOrdered est le cycle réordonné pour matcher pts2d.
 * Retourne null si la face est dégénérée (aires < ε).
 */
function projectCycleTo2d(
  cycle: readonly number[],
  positions: readonly Vector3[],
): { pts2d: { x: number; y: number }[]; cycleOrdered: number[] } | null {
  const n = cycle.length;
  const p0 = positions[cycle[0]!];
  const p1 = positions[cycle[1]!];
  const p2 = positions[cycle[2]!];
  if (!p0 || !p1 || !p2) return null;

  // Normale approximative via cross product des deux premiers edges
  const nx = (p1.y - p0.y) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.y - p0.y);
  const ny = (p1.z - p0.z) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.z - p0.z);
  const nz = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);

  // Projection sur le plan perpendiculaire à l’axe dominant
  let projFn: (v: Vector3) => { x: number; y: number };
  if (az >= ax && az >= ay) {
    projFn = (v) => ({ x: v.x, y: v.y }); // face ~horizontale → plan XY
  } else if (ax >= ay) {
    projFn = (v) => ({ x: v.y, y: v.z }); // face ~perpendiculaire X → plan YZ
  } else {
    projFn = (v) => ({ x: v.x, y: v.z }); // face ~perpendiculaire Y → plan XZ
  }

  const pts2d: { x: number; y: number }[] = [];
  const cycleArr: number[] = [];
  for (const idx of cycle) {
    const p = positions[idx];
    if (!p) return null;
    pts2d.push(projFn(p));
    cycleArr.push(idx);
  }

  const area = signedArea2d(pts2d);
  if (Math.abs(area) < 1e-10) return null; // face dégénérée

  // triangulateSimplePolygon2dCcW requiert CCW (aire > 0)
  if (area < 0) {
    pts2d.reverse();
    cycleArr.reverse();
  }

  return { pts2d, cycleOrdered: cycleArr };
}

/**
 * Triangulation ear-clipping d’un cycle de face volumique.
 *
 * Correcte pour les obstacles concaves (L, U, T…).
 * Fallback automatique sur fanTriangulateVertexIndexCycle si la projection échoue
 * (face dégénérée ou < 3 sommets valides).
 *
 * @param cycle  - Indices dans le tableau global positions (vertexIndexCycle de la face).
 * @param positions - Positions mondiales de tous les sommets du volume.
 * @returns Triplets d’indices globaux dans positions.
 */
export function earcutTriangulateVertexIndexCycle(
  cycle: readonly number[],
  positions: readonly Vector3[],
): [number, number, number][] {
  const n = cycle.length;
  if (n < 3) return [];
  if (n === 3) return [[cycle[0]!, cycle[1]!, cycle[2]!]];

  const proj = projectCycleTo2d(cycle, positions);
  if (proj) {
    const flatIndices = triangulateSimplePolygon2dCcW(proj.pts2d);
    if (flatIndices && flatIndices.length >= 3) {
      const tris: [number, number, number][] = [];
      for (let i = 0; i < flatIndices.length; i += 3) {
        const ia = proj.cycleOrdered[flatIndices[i]!];
        const ib = proj.cycleOrdered[flatIndices[i + 1]!];
        const ic = proj.cycleOrdered[flatIndices[i + 2]!];
        if (ia == null || ib == null || ic == null) continue;
        tris.push([ia, ib, ic]);
      }
      if (tris.length > 0) return tris;
    }
  }

  // Fallback : fan triangulation (convexes OK, concaves potentiellement faux)
  return fanTriangulateVertexIndexCycle(cycle);
}

export function trianglePositionsFromIndices(
  positions: readonly Vector3[],
  i0: number,
  i1: number,
  i2: number
): { a: Vector3; b: Vector3; c: Vector3 } | null {
  if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= positions.length || i1 >= positions.length || i2 >= positions.length) {
    return null;
  }
  return {
    a: positions[i0]!,
    b: positions[i1]!,
    c: positions[i2]!,
  };
}
