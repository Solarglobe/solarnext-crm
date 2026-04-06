/**
 * Volume d’un maillage fermé triangulaire (somme tétraèdres origine — signe cohérent).
 */

import type { Vector3 } from "../types/primitives";
import type { VolumeFace3D } from "../types/volumetric-mesh";
import { cross3, dot3 } from "../utils/math3";

/**
 * Volume absolu (m³) pour un maillage dont les faces sont des triangles (3 indices).
 */
export function computeVolumeM3FromTriangleMesh(
  vertexPositions: readonly Vector3[],
  faces: readonly Pick<VolumeFace3D, "vertexIndexCycle">[]
): number {
  let sum = 0;
  for (const f of faces) {
    const c = f.vertexIndexCycle;
    if (c.length < 3) continue;
    const a = vertexPositions[c[0]];
    const b = vertexPositions[c[1]];
    const c3 = vertexPositions[c[2]];
    if (!a || !b || !c3) continue;
    sum += dot3(a, cross3(b, c3)) / 6;
  }
  return Math.abs(sum);
}
