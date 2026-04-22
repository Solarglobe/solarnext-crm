/**
 * Résout l’index de sommet du maillage le plus proche du point d’impact (triangle touché).
 * Pour géométrie indexée : l’index correspond à l’ordre des sommets métier (ex. cornersWorld du pan).
 */

import * as THREE from "three";
import type { Intersection } from "three";

export function indexedMeshClosestVertexIndexToPoint(
  hit: Pick<Intersection, "object" | "point" | "faceIndex">,
): number | null {
  const obj = hit.object;
  if (!(obj instanceof THREE.Mesh)) return null;
  const g = obj.geometry;
  if (!(g instanceof THREE.BufferGeometry)) return null;
  if (hit.faceIndex == null || hit.faceIndex < 0) return null;
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.itemSize < 3) return null;
  const idx = g.index;
  let ia: number;
  let ib: number;
  let ic: number;
  if (idx) {
    const base = hit.faceIndex * 3;
    if (base + 2 >= idx.count) return null;
    ia = idx.getX(base);
    ib = idx.getX(base + 1);
    ic = idx.getX(base + 2);
  } else {
    const base = hit.faceIndex * 3;
    if (base + 2 >= pos.count) return null;
    ia = base;
    ib = base + 1;
    ic = base + 2;
  }
  const p = hit.point;
  const dist2 = (vi: number) => {
    const x = pos.getX(vi) - p.x;
    const y = pos.getY(vi) - p.y;
    const z = pos.getZ(vi) - p.z;
    return x * x + y * y + z * z;
  };
  let best = ia;
  let bestD = dist2(ia);
  for (const vi of [ib, ic] as const) {
    const d = dist2(vi);
    if (d < bestD) {
      best = vi;
      bestD = d;
    }
  }
  return best;
}
