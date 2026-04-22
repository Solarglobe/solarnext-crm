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
import { legacyPanRawCornerHasExplicitHeightM } from "./explicitLegacyPanCornerZ";
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

export type UnifyLegacyPanCornerZOptions = {
  /**
   * Si true : n’unifie pas un cluster si au moins un sommet a une cote explicite sur le polygone pan
   * (`explicit_polygon_vertex`) — règle d’or « compléter sans corriger l’existant ».
   */
  readonly skipClusterIfAnyExplicitPolygonVertex?: boolean;
  /**
   * Mode toiture fidèle : ignore le cluster si **chaque** sommet a `heightM` explicite sur le polygone raw
   * (aucune moyenne inter-pans sur ces points).
   */
  readonly skipClusterIfAllRawCornersExplicit?: boolean;
};

/**
 * Mutateur : impose le même Z sur les coins de clusters multi-pans (proximité image).
 */
export function unifyLegacyPanCornerZAcrossPans(
  phases: LegacyPanCornerPhase[],
  tolPx: number = LEGACY_SHARED_CORNER_CLUSTER_TOL_PX,
  opts?: UnifyLegacyPanCornerZOptions,
): {
  readonly adjustedClusterCount: number;
  readonly diagnostics: GeometryDiagnostic[];
  /** Pans ayant eu au moins un Z modifié par unify. */
  readonly touchedPanIds: ReadonlySet<string>;
} {
  const diagnostics: GeometryDiagnostic[] = [];
  const touchedPanIds = new Set<string>();
  if (phases.length < 2) {
    return { adjustedClusterCount: 0, diagnostics, touchedPanIds };
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

    if (opts?.skipClusterIfAllRawCornersExplicit) {
      const allRawExplicit = cl.every((r) => legacyPanRawCornerHasExplicitHeightM(phases[r.pi].raw, r.ci));
      if (allRawExplicit) {
        diagnostics.push({
          code: "INTERPAN_UNIFY_SKIPPED_ALL_EXPLICIT_RAW_HEIGHT",
          severity: "info",
          message:
            "Unification Z ignorée : tous les sommets du cluster ont heightM explicite sur le polygone (mode toiture fidèle).",
          context: { clusterSize: cl.length },
        });
        continue;
      }
    }

    if (opts?.skipClusterIfAnyExplicitPolygonVertex) {
      const touchesExplicit = cl.some(
        (r) => phases[r.pi].cornerTraces[r.ci]?.source === "explicit_polygon_vertex",
      );
      if (touchesExplicit) {
        diagnostics.push({
          code: "INTERPAN_UNIFY_SKIPPED_EXPLICIT_VERTEX",
          severity: "info",
          message:
            "Unification Z inter-pans ignorée pour un cluster contenant au moins une cote explicite sur sommet pan (mode fidélité).",
          context: { clusterSize: cl.length },
        });
        continue;
      }
    }

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
    let wroteAny = false;
    for (const r of cl) {
      const rawPan = phases[r.pi].raw;
      if (legacyPanRawCornerHasExplicitHeightM(rawPan, r.ci)) {
        continue;
      }
      const p = phases[r.pi].cornersWorld[r.ci];
      phases[r.pi].cornersWorld[r.ci] = { x: p.x, y: p.y, z: zU };
      roofZTraceRecordStep(phases[r.pi].pan.id, r.ci, "I", zU, { unifyUsedRidgePriority });
      wroteAny = true;
    }

    if (!wroteAny) continue;

    for (const r of cl) {
      touchedPanIds.add(phases[r.pi].pan.id);
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

  return { adjustedClusterCount, diagnostics, touchedPanIds };
}
