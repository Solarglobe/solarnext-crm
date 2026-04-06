/**
 * Cohérence inter-pans : sommets proches en image reçoivent un Z unifié (moyenne pondérée confidence).
 * Opère sur des sommets **mutables** avant immutabilisation finale.
 */

import type { HeightSource } from "../../core/heightResolver";

/** Tolérance image : même ordre que Phase 2 (snap hauteur) pour ne pas laisser diverger des coins « même point ». */
const DEFAULT_TOL_PX = 4;
const Z_UNIFY_EPS_M = 0.001;

export type MutablePanVertexBuild = {
  readonly vertexId: string;
  readonly xPx: number;
  readonly yPx: number;
  readonly xWorldM: number;
  readonly yWorldM: number;
  zWorldM: number;
  heightM: number;
  readonly source: HeightSource | string;
  readonly confidence: number;
};

export type MutablePanVerticesBuild = {
  readonly panIndex: number;
  readonly vertices: MutablePanVertexBuild[];
};

type VRef = MutablePanVertexBuild & { readonly panIndex: number; readonly vertexIndex: number };

function buildProximityClusters(refs: VRef[], tolPx: number): VRef[][] {
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
      if (Math.hypot(refs[i].xPx - refs[j].xPx, refs[i].yPx - refs[j].yPx) <= tolPx) {
        union(i, j);
      }
    }
  }
  const byRoot = new Map<number, VRef[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = byRoot.get(r) ?? [];
    arr.push(refs[i]);
    byRoot.set(r, arr);
  }
  return [...byRoot.values()];
}

export function unifySharedMutablePanVertices(
  builds: readonly MutablePanVerticesBuild[],
  tolPx: number = DEFAULT_TOL_PX,
): { readonly warnings: string[]; readonly adjustedClusterCount: number } {
  const warnings: string[] = [];
  if (builds.length < 2) {
    return { warnings, adjustedClusterCount: 0 };
  }

  const refs: VRef[] = [];
  for (const b of builds) {
    for (let vi = 0; vi < b.vertices.length; vi++) {
      const v = b.vertices[vi];
      refs.push({
        ...v,
        panIndex: b.panIndex,
        vertexIndex: vi,
      });
    }
  }

  const clusters = buildProximityClusters(refs, tolPx);
  let adjustedClusterCount = 0;

  for (const cl of clusters) {
    if (cl.length < 2) continue;
    const zs = cl.map((c) => c.zWorldM);
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    if (zMax - zMin <= Z_UNIFY_EPS_M) continue;

    warnings.push(
      `SHARED_VERTEX_Z_MISMATCH: Δz=${(zMax - zMin).toFixed(4)}m @~(${cl[0].xPx.toFixed(2)},${cl[0].yPx.toFixed(2)})px n=${cl.length}`,
    );

    let wSum = 0;
    let zSum = 0;
    for (const t of cl) {
      const w = Math.max(1e-6, t.confidence);
      zSum += t.zWorldM * w;
      wSum += w;
    }
    const zUnified = zSum / wSum;

    for (const t of cl) {
      const mv = builds[t.panIndex].vertices[t.vertexIndex];
      mv.zWorldM = zUnified;
      mv.heightM = zUnified;
    }
    adjustedClusterCount++;
  }

  if (adjustedClusterCount > 0) {
    warnings.push(`PAN_SHARED_VERTEX_Z_UNIFIED: clusters=${adjustedClusterCount}`);
  }

  return { warnings, adjustedClusterCount };
}
