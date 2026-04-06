/**
 * Verrouillage Z inter-pans pour `buildRoofModel3DFromLegacyGeometry` :
 * sommets image proches appartenant à des pans distincts reçoivent un Z unique
 * (priorité faîtage / lignes structurantes via les traces heightConstraints).
 */

import type { GeometryDiagnostic } from "../types/quality";
import type { Vector3 } from "../types/primitives";
import type { HeightResolutionTrace } from "./heightConstraints";
import { structuralHeightUnifyWeight } from "./heightConstraints";
import type { LegacyPanInput } from "./legacyInput";
import { isRoofZPipelineDevTraceEnabled, roofZTraceLogUnifyCluster, roofZTraceRecordStep } from "./roofZPipelineDevTrace";

/** Tolérance image (px) : même ordre que Phase 2 pour les points « même coin » dessinés sur deux pans. */
export const LEGACY_SHARED_CORNER_CLUSTER_TOL_PX = 6;

const Z_TRIVIAL_EPS_M = 1e-4;

export type LegacyPanCornerPhase = {
  readonly pan: LegacyPanInput;
  readonly raw: LegacyPanInput["polygonPx"];
  cornersWorld: Vector3[];
  readonly cornerTraces: readonly HeightResolutionTrace[];
};

type Ref = { readonly pi: number; readonly ci: number; readonly xPx: number; readonly yPx: number };

function clusterRefsByImageProximity(refs: readonly Ref[], tolPx: number): Ref[][] {
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
  const byRoot = new Map<number, Ref[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = byRoot.get(r) ?? [];
    arr.push(refs[i]);
    byRoot.set(r, arr);
  }
  return [...byRoot.values()];
}

function unifiedZForCluster(
  zs: readonly number[],
  traces: readonly HeightResolutionTrace[],
): number {
  const ridgeIdx: number[] = [];
  for (let i = 0; i < traces.length; i++) {
    const s = traces[i].source;
    if (s === "structural_ridge_endpoint" || s === "structural_line_interpolated_ridge") {
      ridgeIdx.push(i);
    }
  }
  const useIdx = ridgeIdx.length > 0 ? ridgeIdx : traces.map((_, i) => i);
  let wSum = 0;
  let zSum = 0;
  for (const i of useIdx) {
    const w = structuralHeightUnifyWeight(traces[i]);
    zSum += zs[i] * w;
    wSum += w;
  }
  return wSum > 0 ? zSum / wSum : zs[0] ?? 0;
}

/**
 * Mutateur : impose le même Z sur les coins de clusters multi-pans (proximité image).
 */
export function unifyLegacyPanCornerZAcrossPans(
  phases: LegacyPanCornerPhase[],
  tolPx: number = LEGACY_SHARED_CORNER_CLUSTER_TOL_PX,
): { readonly adjustedClusterCount: number; readonly diagnostics: GeometryDiagnostic[] } {
  const diagnostics: GeometryDiagnostic[] = [];
  if (phases.length < 2) {
    return { adjustedClusterCount: 0, diagnostics };
  }

  const refs: Ref[] = [];
  for (let pi = 0; pi < phases.length; pi++) {
    const raw = phases[pi].raw;
    for (let ci = 0; ci < raw.length; ci++) {
      refs.push({ pi, ci, xPx: raw[ci].xPx, yPx: raw[ci].yPx });
    }
  }

  let adjustedClusterCount = 0;
  for (const cl of clusterRefsByImageProximity(refs, tolPx)) {
    if (cl.length < 2) continue;
    const panIndices = new Set(cl.map((r) => r.pi));
    if (panIndices.size < 2) continue;

    const zs = cl.map((r) => phases[r.pi].cornersWorld[r.ci].z);
    const traces = cl.map((r) => phases[r.pi].cornerTraces[r.ci]);
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    if (zMax - zMin <= Z_TRIVIAL_EPS_M) continue;

    const zU = unifiedZForCluster(zs, traces);
    const ridgeIdx: number[] = [];
    for (let i = 0; i < traces.length; i++) {
      const s = traces[i].source;
      if (s === "structural_ridge_endpoint" || s === "structural_line_interpolated_ridge") {
        ridgeIdx.push(i);
      }
    }
    const unifyUsedRidgePriority = ridgeIdx.length > 0;
    if (isRoofZPipelineDevTraceEnabled()) {
      roofZTraceLogUnifyCluster({
        clusterSize: cl.length,
        panIndices: [...new Set(cl.map((x) => x.pi))],
        refs: cl.map((r) => ({
          panId: phases[r.pi].pan.id,
          cornerIndex: r.ci,
          xPx: r.xPx,
          yPx: r.yPx,
        })),
        zsBefore: [...zs],
        zUnified: zU,
        unifyUsedRidgePriority,
        traces: traces.map((t) => t.source),
      });
    }
    for (const r of cl) {
      const p = phases[r.pi].cornersWorld[r.ci];
      phases[r.pi].cornersWorld[r.ci] = { x: p.x, y: p.y, z: zU };
      roofZTraceRecordStep(phases[r.pi].pan.id, r.ci, "I", zU, { unifyUsedRidgePriority });
    }

    adjustedClusterCount++;
    diagnostics.push({
      code: "INTERPAN_SHARED_CORNER_Z_LOCKED",
      severity: "info",
      message: `Z unifié sur raccord multi-pans (Δz avant=${(zMax - zMin).toFixed(4)} m → ${zU.toFixed(4)} m, n=${cl.length})`,
      context: { clusterSize: cl.length, deltaZM: zMax - zMin },
    });
  }

  if (adjustedClusterCount > 0) {
    diagnostics.push({
      code: "INTERPAN_SHARED_CORNER_Z_SUMMARY",
      severity: "info",
      message: `${adjustedClusterCount} cluster(s) de coins partagés : Z verrouillé entre pans`,
      context: { clusterCount: adjustedClusterCount },
    });
  }

  return { adjustedClusterCount, diagnostics };
}
