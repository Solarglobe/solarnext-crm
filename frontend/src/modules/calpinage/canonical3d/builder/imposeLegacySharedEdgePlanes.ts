/**
 * Après unification Z des coins : impose que chaque pan soit un plan strict qui contient
 * l’arête 3D commune avec son voisin (détectée en 2D image), en réajustant uniquement Z.
 *
 * Évite la cassure / torsion lorsque Newell sur polygone quasi-planaire diverge légerement
 * de la ligne de raccord réelle entre deux faces.
 */

import type { GeometryDiagnostic } from "../types/quality";
import type { Vector3 } from "../types/primitives";
import { cross3, dot3, length3, normalize3, sub3 } from "../utils/math3";
import { orientExteriorNormalTowardSky } from "./planePolygon3d";
import { legacyPanRawCornerHasExplicitHeightM } from "./explicitLegacyPanCornerZ";
import type { LegacyPanCornerPhase } from "./unifyLegacyPanSharedCornersZ";
import { LEGACY_SHARED_CORNER_CLUSTER_TOL_PX } from "./unifyLegacyPanSharedCornersZ";
import {
  isRoofZPipelineDevTraceEnabled,
  roofZTraceLogImpose,
  roofZTraceRecordStep,
} from "./roofZPipelineDevTrace";

const MIN_SHARED_EDGE_LEN_PX = 3;
const NZ_MIN = 1e-3;
const CROSS_MIN = 1e-8;

type EdgeMatch = {
  readonly panA: number;
  readonly panB: number;
  readonly iA0: number;
  readonly iA1: number;
  readonly iB0: number;
  readonly iB1: number;
  /** true si a0↔b1 et a1↔b0 (orientation opposée sur le bord commun). */
  readonly flipped: boolean;
  readonly lenSqPx: number;
};

function distPx(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(ax - bx, ay - by);
}

function tryMatchDirectedEdge(
  rawA: LegacyPanCornerPhase["raw"],
  rawB: LegacyPanCornerPhase["raw"],
  ia: number,
  ib: number,
  tolPx: number,
): { iA0: number; iA1: number; iB0: number; iB1: number; flipped: boolean } | null {
  const na = rawA.length;
  const nb = rawB.length;
  const a0 = rawA[ia];
  const a1 = rawA[(ia + 1) % na];
  const b0 = rawB[ib];
  const b1 = rawB[(ib + 1) % nb];

  if (distPx(a0.xPx, a0.yPx, b0.xPx, b0.yPx) <= tolPx && distPx(a1.xPx, a1.yPx, b1.xPx, b1.yPx) <= tolPx) {
    return { iA0: ia, iA1: (ia + 1) % na, iB0: ib, iB1: (ib + 1) % nb, flipped: false };
  }
  if (distPx(a0.xPx, a0.yPx, b1.xPx, b1.yPx) <= tolPx && distPx(a1.xPx, a1.yPx, b0.xPx, b0.yPx) <= tolPx) {
    return { iA0: ia, iA1: (ia + 1) % na, iB0: ib, iB1: (ib + 1) % nb, flipped: true };
  }
  return null;
}

function edgeLenSqPx(raw: LegacyPanCornerPhase["raw"], i0: number, i1: number): number {
  const a = raw[i0];
  const b = raw[i1];
  const dx = a.xPx - b.xPx;
  const dy = a.yPx - b.yPx;
  return dx * dx + dy * dy;
}

function findBestSharedEdgeBetweenPans(
  phases: readonly LegacyPanCornerPhase[],
  pi: number,
  pj: number,
  tolPx: number,
  minSharedEdgeLenPx: number,
): EdgeMatch | null {
  const minSq = minSharedEdgeLenPx * minSharedEdgeLenPx;
  const rawA = phases[pi].raw;
  const rawB = phases[pj].raw;
  const na = rawA.length;
  const nb = rawB.length;
  let best: EdgeMatch | null = null;
  for (let ia = 0; ia < na; ia++) {
    if (edgeLenSqPx(rawA, ia, (ia + 1) % na) < minSq) continue;
    for (let ib = 0; ib < nb; ib++) {
      if (edgeLenSqPx(rawB, ib, (ib + 1) % nb) < minSq) continue;
      const m = tryMatchDirectedEdge(rawA, rawB, ia, ib, tolPx);
      if (!m) continue;
      const lenSq = edgeLenSqPx(rawA, m.iA0, m.iA1);
      if (!best || lenSq > best.lenSqPx) {
        best = {
          panA: pi,
          panB: pj,
          iA0: m.iA0,
          iA1: m.iA1,
          iB0: m.iB0,
          iB1: m.iB1,
          flipped: m.flipped,
          lenSqPx: lenSq,
        };
      }
    }
  }
  return best;
}

function avgWorld(
  phases: readonly LegacyPanCornerPhase[],
  pi: number,
  ci: number,
  pj: number,
  cj: number,
): Vector3 {
  const a = phases[pi].cornersWorld[ci];
  const b = phases[pj].cornersWorld[cj];
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    z: (a.z + b.z) * 0.5,
  };
}

function distPointToLineSq(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = sub3(b, a);
  const ab2 = dot3(ab, ab);
  if (ab2 < 1e-20) return length3(sub3(p, a)) ** 2;
  const t = dot3(sub3(p, a), ab) / ab2;
  const proj = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
  const dx = p.x - proj.x;
  const dy = p.y - proj.y;
  const dz = p.z - proj.z;
  return dx * dx + dy * dy + dz * dz;
}

function pickReferenceCornerIndex(
  phase: LegacyPanCornerPhase,
  skip: ReadonlySet<number>,
  p: Vector3,
  q: Vector3,
): number | null {
  const n = phase.cornersWorld.length;
  let bestI: number | null = null;
  let bestD = -1;
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    const d = distPointToLineSq(phase.cornersWorld[i], p, q);
    if (d > bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

/**
 * Recalcule les Z du pan pour qu’ils coïncident avec le plan contenant P,Q et le point de référence.
 * XY inchangés.
 */
function projectPanCornersOntoPlaneThroughEdge(
  phase: LegacyPanCornerPhase,
  p: Vector3,
  q: Vector3,
  refIdx: number,
  upWorld: Vector3,
): boolean {
  const r = phase.cornersWorld[refIdx];
  const u = sub3(q, p);
  const v = sub3(r, p);
  const nRaw = cross3(u, v);
  const nLen = length3(nRaw);
  if (nLen < CROSS_MIN) return false;
  const nUnit = normalize3(nRaw);
  if (!nUnit) return false;
  const exterior = orientExteriorNormalTowardSky(nUnit, upWorld);
  if (Math.abs(exterior.z) < NZ_MIN) return false;

  const d = -dot3(exterior, p);
  const nx = exterior.x;
  const ny = exterior.y;
  const nz = exterior.z;

  let updatedAny = false;
  for (let i = 0; i < phase.cornersWorld.length; i++) {
    if (legacyPanRawCornerHasExplicitHeightM(phase.raw, i)) {
      continue;
    }
    const c = phase.cornersWorld[i];
    const zNew = (-d - nx * c.x - ny * c.y) / nz;
    if (!Number.isFinite(zNew)) return false;
    phase.cornersWorld[i] = { x: c.x, y: c.y, z: zNew };
    updatedAny = true;
  }
  return updatedAny;
}

export type ImposeLegacySharedEdgePlanesOptions = {
  /**
   * Si true : n’impose pas de plan sur une paire de pans si l’un ou l’autre a au moins un sommet
   * avec cote explicite sur polygone pan — évite de réécrire tous les Z du pan (mode fidélité).
   */
  readonly skipIfEitherPanHasExplicitVertex?: boolean;
  /**
   * Mode toiture fidèle : si les **quatre** sommets d’arête commune (2 par pan) ont `heightM` explicite
   * sur le polygone raw, ne pas lancer la projection de plan (arête entièrement relevée).
   */
  readonly skipPairIfSharedEdgeEndpointsFullyExplicit?: boolean;
  /** Longueur minimale d’arête (px) pour matcher — niveau 2 : `legacyMinSharedEdgeLenPx(cornerTol)`. */
  readonly minSharedEdgeLenPx?: number;
};

function phaseHasExplicitPolygonVertex(phase: LegacyPanCornerPhase): boolean {
  return phase.cornerTraces.some((t) => t.source === "explicit_polygon_vertex");
}

/**
 * Détecte les arêtes 2D communes (une par paire de pans, la plus longue),
 * construit P,Q 3D canoniques, puis recalcule chaque pan voisin sur son plan passant par PQ.
 */
export function imposeLegacyPanPlanesThroughSharedEdges(
  phases: LegacyPanCornerPhase[],
  upWorld: Vector3,
  tolPx: number = LEGACY_SHARED_CORNER_CLUSTER_TOL_PX,
  opts?: ImposeLegacySharedEdgePlanesOptions,
): {
  readonly diagnostics: GeometryDiagnostic[];
  /** Pans ayant eu au moins un Z modifié par impose (projection plan). */
  readonly touchedPanIds: ReadonlySet<string>;
} {
  const diagnostics: GeometryDiagnostic[] = [];
  const touchedPanIds = new Set<string>();
  if (phases.length < 2) {
    return { diagnostics, touchedPanIds };
  }

  const minEdgeLenPx =
    typeof opts?.minSharedEdgeLenPx === "number" && Number.isFinite(opts.minSharedEdgeLenPx) && opts.minSharedEdgeLenPx > 0
      ? opts.minSharedEdgeLenPx
      : MIN_SHARED_EDGE_LEN_PX;

  const applied = new Set<number>();
  let pairCount = 0;

  for (let pi = 0; pi < phases.length; pi++) {
    for (let pj = pi + 1; pj < phases.length; pj++) {
      if (opts?.skipIfEitherPanHasExplicitVertex) {
        if (phaseHasExplicitPolygonVertex(phases[pi]) || phaseHasExplicitPolygonVertex(phases[pj])) {
          continue;
        }
      }

      const em = findBestSharedEdgeBetweenPans(phases, pi, pj, tolPx, minEdgeLenPx);
      if (!em) continue;

      if (opts?.skipPairIfSharedEdgeEndpointsFullyExplicit) {
        const rawA = phases[pi].raw;
        const rawB = phases[pj].raw;
        if (
          legacyPanRawCornerHasExplicitHeightM(rawA, em.iA0) &&
          legacyPanRawCornerHasExplicitHeightM(rawA, em.iA1) &&
          legacyPanRawCornerHasExplicitHeightM(rawB, em.iB0) &&
          legacyPanRawCornerHasExplicitHeightM(rawB, em.iB1)
        ) {
          diagnostics.push({
            code: "INTERPAN_IMPOSE_SKIPPED_EXPLICIT_SHARED_EDGE",
            severity: "info",
            message:
              "Imposition de plan ignorée : les deux extrémités d’arête commune ont heightM explicite sur les deux pans (mode toiture fidèle).",
            context: { panA: phases[pi].pan.id, panB: phases[pj].pan.id },
          });
          continue;
        }
      }

      const iBpForP = em.flipped ? em.iB1 : em.iB0;
      const iBpForQ = em.flipped ? em.iB0 : em.iB1;
      const p = avgWorld(phases, pi, em.iA0, pj, iBpForP);
      const q = avgWorld(phases, pi, em.iA1, pj, iBpForQ);
      const edgeLenM = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (edgeLenM < 1e-6) continue;

      const skipA = new Set<number>([em.iA0, em.iA1]);
      const skipB = new Set<number>([em.iB0, em.iB1]);
      const refA = pickReferenceCornerIndex(phases[pi], skipA, p, q);
      const refB = pickReferenceCornerIndex(phases[pj], skipB, p, q);
      if (refA == null || refB == null) continue;

      const zsBeforeA = phases[pi].cornersWorld.map((c) => c.z);
      const zsBeforeB = phases[pj].cornersWorld.map((c) => c.z);

      const okA = projectPanCornersOntoPlaneThroughEdge(phases[pi], p, q, refA, upWorld);
      const okB = projectPanCornersOntoPlaneThroughEdge(phases[pj], p, q, refB, upWorld);

      if (isRoofZPipelineDevTraceEnabled()) {
        const zsAfterA = phases[pi].cornersWorld.map((c) => c.z);
        const zsAfterB = phases[pj].cornersWorld.map((c) => c.z);
        roofZTraceLogImpose({
          panA: phases[pi].pan.id,
          panB: phases[pj].pan.id,
          sharedEdge: {
            iA0: em.iA0,
            iA1: em.iA1,
            iB0: em.iB0,
            iB1: em.iB1,
            flipped: em.flipped,
            lenSqPx: em.lenSqPx,
          },
          P: { ...p },
          Q: { ...q },
          refCornerIndexA: refA,
          refCornerIndexB: refB,
          okA,
          okB,
          zsBeforeA,
          zsAfterA,
          zsBeforeB,
          zsAfterB,
        });
      }
      if (okA) {
        const pid = phases[pi].pan.id;
        for (let i = 0; i < phases[pi].cornersWorld.length; i++) {
          roofZTraceRecordStep(pid, i, "J", phases[pi].cornersWorld[i].z, { pair: `${phases[pi].pan.id}+${phases[pj].pan.id}` });
        }
      }
      if (okB) {
        const pid = phases[pj].pan.id;
        for (let i = 0; i < phases[pj].cornersWorld.length; i++) {
          roofZTraceRecordStep(pid, i, "J", phases[pj].cornersWorld[i].z, { pair: `${phases[pi].pan.id}+${phases[pj].pan.id}` });
        }
      }

      if (okA) {
        applied.add(pi);
        touchedPanIds.add(phases[pi].pan.id);
      }
      if (okB) {
        applied.add(pj);
        touchedPanIds.add(phases[pj].pan.id);
      }

      if (okA || okB) {
        pairCount++;
        diagnostics.push({
          code: "INTERPAN_SHARED_EDGE_PLANE_LOCKED",
          severity: "info",
          message: `Plan imposé par arête 3D commune entre pans (longueur ≈ ${edgeLenM.toFixed(3)} m)`,
          context: { edgeLenM, panA: phases[pi].pan.id, panB: phases[pj].pan.id },
        });
      }
    }
  }

  if (pairCount > 0) {
    diagnostics.push({
      code: "INTERPAN_SHARED_EDGE_PLANE_SUMMARY",
      severity: "info",
      message: `${pairCount} paire(s) de pans : arête de raccord 3D commune + plans recalculés (Z)`,
      context: { pairCount, panTouched: applied.size },
    });
  }

  return { diagnostics, touchedPanIds };
}
