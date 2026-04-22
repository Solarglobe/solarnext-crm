/**
 * Niveau 2 — rapproche les sommets 2D entre pans distincts (px) pour améliorer la détection d’arêtes communes.
 */

import type { LegacyImagePoint2D, LegacyPanInput } from "./legacyInput";

type Ref = { readonly pi: number; readonly vi: number; readonly x: number; readonly y: number };

function clusterRefsByProximity(refs: readonly Ref[], tolPx: number): Ref[][] {
  const n = refs.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(a: number): number {
    return parent[a] === a ? a : (parent[a] = find(parent[a]));
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (refs[i]!.pi === refs[j]!.pi) continue;
      if (Math.hypot(refs[i]!.x - refs[j]!.x, refs[i]!.y - refs[j]!.y) <= tolPx) {
        union(i, j);
      }
    }
  }
  const byRoot = new Map<number, Ref[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = byRoot.get(r) ?? [];
    arr.push(refs[i]!);
    byRoot.set(r, arr);
  }
  return [...byRoot.values()];
}

/**
 * Modifie les `polygonPx` en place. Ne fusionne que des sommets appartenant à **des pans différents**.
 * @returns nombre de sommets dont les coordonnées ont été modifiées.
 */
export function snapLegacyPanPolygonVerticesInPlace(pans: LegacyPanInput[], tolPx: number): number {
  if (pans.length < 2 || !Number.isFinite(tolPx) || tolPx <= 0) return 0;

  const refs: Ref[] = [];
  for (let pi = 0; pi < pans.length; pi++) {
    const poly = pans[pi]!.polygonPx;
    for (let vi = 0; vi < poly.length; vi++) {
      const p = poly[vi]!;
      refs.push({ pi, vi, x: p.xPx, y: p.yPx });
    }
  }

  const clusters = clusterRefsByProximity(refs, tolPx);
  let changed = 0;
  for (const group of clusters) {
    if (group.length < 2) continue;
    const pansInGroup = new Set(group.map((g) => g.pi));
    if (pansInGroup.size < 2) continue;

    let sx = 0;
    let sy = 0;
    for (const r of group) {
      sx += r.x;
      sy += r.y;
    }
    const mx = sx / group.length;
    const my = sy / group.length;

    for (const r of group) {
      const pt = pans[r.pi]!.polygonPx[r.vi]!;
      if (Math.abs(pt.xPx - mx) > 1e-9 || Math.abs(pt.yPx - my) > 1e-9) {
        changed++;
      }
      const polyMut = pans[r.pi]!.polygonPx as unknown as LegacyImagePoint2D[];
      polyMut[r.vi] =
        pt.heightM !== undefined
          ? { xPx: mx, yPx: my, heightM: pt.heightM }
          : { xPx: mx, yPx: my };
    }
  }
  return changed;
}
