/**
 * Mesure l’écart vertical couronne shell vs plan du pan dominant (même XY) — lecture seule sur `SolarScene3D`.
 * Ne modifie aucun rendu ; utile pour quantifier l’incohérence « enveloppe vs toit ».
 */

import { resolveLocalRoofZAtXY } from "../builder/shellContourLocalRoofZ";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { SolarScene3D } from "../types/solarScene3d";
import type { WorldPosition3D } from "../types/coordinates";
import type { BuildingShell3D } from "../types/building-shell-3d";

const EPS_NZ = 1e-6;

export type RoofShellVerticalGapStatsM = {
  /** max |Δz| sur l’anneau haut (m). */
  readonly maxAbsM: number;
  /** moyenne |Δz| (m). */
  readonly meanAbsM: number;
  readonly rmsM: number;
  /** max (z_shell − z_plan) — signe : shell au-dessus du plan dominant si > 0. */
  readonly maxSignedM: number;
  /** min (z_shell − z_plan). */
  readonly minSignedM: number;
};

export type RoofShellAlignmentDiagnostics = {
  readonly ok: boolean;
  readonly reason?: string;
  readonly dominantPanId: string | null;
  readonly dominantPanProjectedAreaM2: number | null;
  /** Nombre de sommets sur la couronne haute (`edges` kind `top`). */
  readonly topRingVertexCount: number;
  /** Tous les sommets de la couronne (ordre cyclique quand déductible). */
  readonly verticalGapVsDominantPlaneFullRingM: RoofShellVerticalGapStatsM | null;
  /**
   * Sous-échantillon le long du périmètre dense (ordre cyclique) — au plus `perimeterSampleBudget` points.
   */
  readonly verticalGapVsDominantPlanePerimeterSparseM: RoofShellVerticalGapStatsM | null;
  readonly perimeterSparseSampleCount: number;
};

export type ComputeRoofShellAlignmentDiagnosticsOptions = {
  /**
   * Nombre max de points pour la métrique « périmètre sparse » (≥ 3 recommandé).
   * @default 12
   */
  readonly perimeterSampleBudget?: number;
};

function polygonProjectedAreaM2(corners: readonly WorldPosition3D[]): number {
  let a = 0;
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % n]!;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) * 0.5;
}

function patchDominantProjectedAreaM2(p: RoofPlanePatch3D): number {
  const ph = p.surface.projectedHorizontalAreaM2;
  if (typeof ph === "number" && Number.isFinite(ph) && ph > 0) return ph;
  return polygonProjectedAreaM2(p.cornersWorld);
}

function zOnPatchPlaneAtXY(patch: RoofPlanePatch3D, x: number, y: number): number | null {
  const { normal, d } = patch.equation;
  const nz = normal.z;
  if (!Number.isFinite(nz) || Math.abs(nz) < EPS_NZ) return null;
  const z = -(normal.x * x + normal.y * y + d) / nz;
  return Number.isFinite(z) ? z : null;
}

function pickGlobalDominantPatch(patches: readonly RoofPlanePatch3D[]): RoofPlanePatch3D | null {
  if (!patches.length) return null;
  let best = patches[0]!;
  let bestA = patchDominantProjectedAreaM2(best);
  for (let i = 1; i < patches.length; i++) {
    const p = patches[i]!;
    const a = patchDominantProjectedAreaM2(p);
    if (a > bestA + 1e-12) {
      best = p;
      bestA = a;
      continue;
    }
    if (Math.abs(a - bestA) <= 1e-12 * Math.max(bestA, 1)) {
      const idBest = String(best.id);
      const idP = String(p.id);
      if (idP.localeCompare(idBest) < 0) {
        best = p;
        bestA = a;
      }
    }
  }
  return best;
}

/** Ordre cyclique des sommets de la couronne haute via les arêtes `kind === "top"`. */
function orderedTopRingVertexIndices(shell: BuildingShell3D): number[] | null {
  const topEdges = shell.edges.filter((e) => e.kind === "top");
  if (topEdges.length < 3) return null;

  const adj = new Map<number, number[]>();
  const add = (u: number, v: number) => {
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u)!.push(v);
    adj.get(v)!.push(u);
  };
  for (const e of topEdges) {
    add(e.vertexAIndex, e.vertexBIndex);
  }

  const start = topEdges[0]!.vertexAIndex;
  if (!adj.has(start)) return null;

  let prev = -1;
  let cur = start;
  const order: number[] = [];

  for (let guard = 0; guard <= topEdges.length + 4; guard++) {
    order.push(cur);
    const neighbors = adj.get(cur);
    if (!neighbors || neighbors.length === 0) return null;
    const next = neighbors.find((v) => v !== prev);
    if (next == null) return null;
    if (next === start && order.length >= 3) {
      return order;
    }
    prev = cur;
    cur = next;
  }
  return null;
}

function uniqueTopRingVertexIndices(shell: BuildingShell3D): number[] {
  const set = new Set<number>();
  for (const e of shell.edges) {
    if (e.kind !== "top") continue;
    set.add(e.vertexAIndex);
    set.add(e.vertexBIndex);
  }
  return [...set].sort((a, b) => a - b);
}

function statsFromGaps(gaps: readonly number[]): RoofShellVerticalGapStatsM | null {
  if (!gaps.length) return null;
  let maxAbs = 0;
  let sumAbs = 0;
  let sumSq = 0;
  let maxS = -Infinity;
  let minS = Infinity;
  for (const g of gaps) {
    const ag = Math.abs(g);
    maxAbs = Math.max(maxAbs, ag);
    sumAbs += ag;
    sumSq += g * g;
    maxS = Math.max(maxS, g);
    minS = Math.min(minS, g);
  }
  const n = gaps.length;
  return {
    maxAbsM: maxAbs,
    meanAbsM: sumAbs / n,
    rmsM: Math.sqrt(sumSq / n),
    maxSignedM: maxS,
    minSignedM: minS,
  };
}

function subsampleIndices(n: number, budget: number): number[] {
  if (n <= 0) return [];
  const cap = Math.max(3, Math.min(budget, n));
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < cap; k++) {
    out.push(Math.floor((k * (n - 1)) / (cap - 1)));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function gapsForIndices(
  shell: BuildingShell3D,
  indices: readonly number[],
  dominant: RoofPlanePatch3D,
): number[] {
  const gaps: number[] = [];
  for (const idx of indices) {
    const v = shell.vertices[idx]?.position;
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
    const zPlane = zOnPatchPlaneAtXY(dominant, v.x, v.y);
    if (zPlane == null) continue;
    gaps.push(v.z - zPlane);
  }
  return gaps;
}

/**
 * @param scene Scène produit (même repère WORLD pour `roofModel` et `buildingShell`).
 */
export function computeRoofShellAlignmentDiagnostics(
  scene: SolarScene3D,
  options?: ComputeRoofShellAlignmentDiagnosticsOptions,
): RoofShellAlignmentDiagnostics {
  const perimeterSampleBudget = options?.perimeterSampleBudget ?? 12;

  const shell = scene.buildingShell;
  if (!shell) {
    return {
      ok: false,
      reason: "NO_BUILDING_SHELL",
      dominantPanId: null,
      dominantPanProjectedAreaM2: null,
      topRingVertexCount: 0,
      verticalGapVsDominantPlaneFullRingM: null,
      verticalGapVsDominantPlanePerimeterSparseM: null,
      perimeterSparseSampleCount: 0,
    };
  }

  const patches = scene.roofModel.roofPlanePatches;
  if (!patches.length) {
    return {
      ok: false,
      reason: "NO_ROOF_PLANE_PATCHES",
      dominantPanId: null,
      dominantPanProjectedAreaM2: null,
      topRingVertexCount: 0,
      verticalGapVsDominantPlaneFullRingM: null,
      verticalGapVsDominantPlanePerimeterSparseM: null,
      perimeterSparseSampleCount: 0,
    };
  }

  const dominant = pickGlobalDominantPatch(patches);
  if (!dominant) {
    return {
      ok: false,
      reason: "NO_DOMINANT_PATCH",
      dominantPanId: null,
      dominantPanProjectedAreaM2: null,
      topRingVertexCount: 0,
      verticalGapVsDominantPlaneFullRingM: null,
      verticalGapVsDominantPlanePerimeterSparseM: null,
      perimeterSparseSampleCount: 0,
    };
  }

  const domArea = patchDominantProjectedAreaM2(dominant);
  const ordered = orderedTopRingVertexIndices(shell);
  const fallbackIdx = uniqueTopRingVertexIndices(shell);
  const ringIndices = ordered ?? fallbackIdx;

  if (ringIndices.length < 3) {
    return {
      ok: false,
      reason: "SHELL_TOP_RING_INCOMPLETE",
      dominantPanId: String(dominant.id),
      dominantPanProjectedAreaM2: domArea,
      topRingVertexCount: fallbackIdx.length,
      verticalGapVsDominantPlaneFullRingM: null,
      verticalGapVsDominantPlanePerimeterSparseM: null,
      perimeterSparseSampleCount: 0,
    };
  }

  const fullGaps = gapsForIndices(shell, ringIndices, dominant);
  const fullStats = statsFromGaps(fullGaps);

  let sparseStats: RoofShellVerticalGapStatsM | null = null;
  let sparseCount = 0;
  if (ordered) {
    const pick = subsampleIndices(ordered.length, perimeterSampleBudget);
    const sparseIdx = pick.map((i) => ordered[i]!);
    const sparseGaps = gapsForIndices(shell, sparseIdx, dominant);
    sparseStats = statsFromGaps(sparseGaps);
    sparseCount = sparseGaps.length;
  } else {
    const pick = subsampleIndices(fallbackIdx.length, perimeterSampleBudget);
    const sparseIdx = pick.map((i) => fallbackIdx[i]!);
    const sparseGaps = gapsForIndices(shell, sparseIdx, dominant);
    sparseStats = statsFromGaps(sparseGaps);
    sparseCount = sparseGaps.length;
  }

  if (!fullStats) {
    return {
      ok: false,
      reason: "DOMINANT_PLANE_VERTICAL_OR_BAD_VERTICES",
      dominantPanId: String(dominant.id),
      dominantPanProjectedAreaM2: domArea,
      topRingVertexCount: fallbackIdx.length,
      verticalGapVsDominantPlaneFullRingM: null,
      verticalGapVsDominantPlanePerimeterSparseM: sparseStats,
      perimeterSparseSampleCount: sparseCount,
    };
  }

  return {
    ok: true,
    dominantPanId: String(dominant.id),
    dominantPanProjectedAreaM2: domArea,
    topRingVertexCount: fallbackIdx.length,
    verticalGapVsDominantPlaneFullRingM: fullStats,
    verticalGapVsDominantPlanePerimeterSparseM: sparseStats,
    perimeterSparseSampleCount: sparseCount,
  };
}

/** Objet sérialisable pour `logCalpinage3DDebug` — pas de références circulaires. */
export function roofShellAlignmentDiagnosticsToDebugPayload(d: RoofShellAlignmentDiagnostics): Record<string, unknown> {
  return {
    ok: d.ok,
    reason: d.reason ?? null,
    dominantPanId: d.dominantPanId,
    dominantPanProjectedAreaM2: d.dominantPanProjectedAreaM2,
    topRingVertexCount: d.topRingVertexCount,
    perimeterSparseSampleCount: d.perimeterSparseSampleCount,
    fullRing: d.verticalGapVsDominantPlaneFullRingM,
    perimeterSparse: d.verticalGapVsDominantPlanePerimeterSparseM,
  };
}

/** Une ligne lisible (bandeau dev / panneau inspection). */
export function formatRoofShellAlignmentOneLine(d: RoofShellAlignmentDiagnostics): string {
  if (!d.ok) {
    return `shell↔pan dominant : ${d.reason ?? "indisponible"}`;
  }
  const f = d.verticalGapVsDominantPlaneFullRingM;
  const s = d.verticalGapVsDominantPlanePerimeterSparseM;
  const bits: string[] = [`pan=${d.dominantPanId}`, `couronne n=${d.topRingVertexCount}`];
  if (f) {
    bits.push(`max|Δz|=${f.maxAbsM.toFixed(3)} m`, `moy|Δz|=${f.meanAbsM.toFixed(3)} m`);
  }
  if (s && d.perimeterSparseSampleCount > 0) {
    bits.push(`échantillon périm. (${d.perimeterSparseSampleCount}) max|Δz|=${s.maxAbsM.toFixed(3)} m`);
  }
  return `shell↔pan dominant : ${bits.join(" · ")}`;
}

/**
 * Erreur max sur le milieu des arêtes de la couronne haute : |(z_a+z_b)/2 − z_toit(x_m,y_m)|
 * où `z_toit` est la résolution multi-pans identique au build shell (pas le plan dominant seul).
 * Mesure les **cordes** entre sommets quand le toit n’est pas linéaire le long de l’arête.
 */
export function computeShellTopRingMidEdgeRoofChordErrorMaxM(scene: SolarScene3D): number | null {
  const shell = scene.buildingShell;
  const patches = scene.roofModel.roofPlanePatches;
  if (!shell || patches.length === 0) return null;

  const ordered = orderedTopRingVertexIndices(shell);
  if (!ordered || ordered.length < 3) return null;

  let maxErr = 0;
  for (let i = 0; i < ordered.length; i++) {
    const ia = ordered[i]!;
    const ib = ordered[(i + 1) % ordered.length]!;
    const va = shell.vertices[ia]?.position;
    const vb = shell.vertices[ib]?.position;
    if (!va || !vb) continue;
    const mx = (va.x + vb.x) * 0.5;
    const my = (va.y + vb.y) * 0.5;
    const zLin = (va.z + vb.z) * 0.5;
    const zRoof = resolveLocalRoofZAtXY(patches, mx, my);
    if (zRoof == null || !Number.isFinite(zRoof)) continue;
    maxErr = Math.max(maxErr, Math.abs(zLin - zRoof));
  }
  return maxErr;
}
