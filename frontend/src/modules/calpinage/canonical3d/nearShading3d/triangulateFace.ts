/**
 * Décomposition d’un cycle de face en triangles (éventail depuis l’indice 0) — même convention que les builders volumiques.
 */

import type { Vector3 } from "../types/primitives";

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
