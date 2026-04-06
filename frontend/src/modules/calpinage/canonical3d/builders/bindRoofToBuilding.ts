/**
 * Ancrage métier toiture ↔ bâtiment : consomme uniquement la chaîne canonique déjà construite
 * (`BuildingShell3D`, `RoofTopologyGraph`, `RoofPlaneSolutionSet`, `RoofIntersectionSet`).
 * Aucune lecture `CALPINAGE_STATE`, `window`, ni recalcul topologie / plans / intersections.
 *
 * @see docs/architecture/roof-building-binding.md
 */

import type { BuildingLocalVec3 } from "../model/canonicalHouse3DModel";
import type { BuildingShell3D } from "../model/buildingShell3DModel";
import type { RoofPlaneEquation, RoofPatchPlaneSolution, RoofPlaneSolutionSet } from "../model/roofPlaneSolutionModel";
import type { RoofIntersectionSet } from "../model/roofIntersectionModel";
import type {
  BindRoofToBuildingInput,
  BindRoofToBuildingOutput,
  RoofBindingDiagnosticNote,
  RoofBindingIntersectionCrossCheck,
  RoofBindingStructuralProof,
  RoofBuildingBindingDiagnostics,
  RoofBuildingBindingResult,
  RoofEaveWallBinding,
  RoofFreeRidgeBinding,
  RoofGableWallBinding,
  RoofOverhangBinding,
  RoofOverhangIntentFlag,
  RoofRidgeSupportStatus,
} from "../model/roofBuildingBindingModel";
import {
  ROOF_BUILDING_BINDING_SCHEMA_ID,
} from "../model/roofBuildingBindingModel";
import type { RoofTopologyGraph, RoofTopologyGraphEdge } from "../model/roofTopologyModel";
import { evaluateZOnRoofPlane } from "./solveRoofPlanes";

const DEFAULT_Z_SNAP = 0.02;
const DEFAULT_WALL_XY_TOL = 0.08;
const DEFAULT_INTENTIONAL_OVERHANG = 0.05;
const DEFAULT_MATCH_AMBIGUITY_EPS = 0.02;
const DEFAULT_PARALLEL_OFFSET_MAX = 1.5;
const PARALLEL_DOT_THRESHOLD = 0.995;
const EPS_LEN2 = 1e-18;
const EPS_Z = 1e-9;

type WallTopCandidate = {
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly outwardNx: number;
  readonly outwardNy: number;
};

function distPointToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < EPS_LEN2) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/** Distance perpendiculaire d’un point à la droite (A,B) infinie (plan XY). */
function distPointToInfiniteLine2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const len = Math.hypot(abx, aby);
  if (len < EPS_LEN2) return Math.hypot(apx, apy);
  return Math.abs(apx * aby - apy * abx) / len;
}

function outwardScalarXY(px: number, py: number, ax: number, ay: number, nx: number, ny: number): number {
  return (px - ax) * nx + (py - ay) * ny;
}

function buildVertexXYMap(graph: RoofTopologyGraph): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  for (const v of graph.vertices) {
    m.set(v.topologyVertexId, { x: v.positionXY.x, y: v.positionXY.y });
  }
  return m;
}

function buildSolutionByPatchId(set: RoofPlaneSolutionSet): Map<string, RoofPatchPlaneSolution> {
  const m = new Map<string, RoofPatchPlaneSolution>();
  for (const s of set.solutions) {
    m.set(s.roofPatchId, s);
  }
  return m;
}

function pickPlaneForEdge(edge: RoofTopologyGraphEdge, byPatch: Map<string, RoofPatchPlaneSolution>): RoofPlaneEquation | null {
  for (const pid of edge.incidentPatchIds) {
    const sol = byPatch.get(pid);
    if (sol?.planeEquation) return sol.planeEquation;
  }
  return null;
}

function buildWallTopCandidates(shell: BuildingShell3D): WallTopCandidate[] {
  const pos = new Map<string, BuildingLocalVec3>();
  for (const v of shell.topRing.vertices) {
    pos.set(v.vertexId, v.position);
  }
  const out: WallTopCandidate[] = [];
  for (let i = 0; i < shell.topRing.segments.length; i++) {
    const seg = shell.topRing.segments[i]!;
    const pa = pos.get(seg.vertexIdA);
    const pb = pos.get(seg.vertexIdB);
    if (!pa || !pb) continue;
    const wf = shell.wallFaces[i];
    const nx = wf?.outwardNormal.x ?? 0;
    const ny = wf?.outwardNormal.y ?? 0;
    out.push({
      segmentId: seg.segmentId,
      segmentIndex: i,
      ax: pa.x,
      ay: pa.y,
      bx: pb.x,
      by: pb.y,
      outwardNx: nx,
      outwardNy: ny,
    });
  }
  return out;
}

function matchWallSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  walls: WallTopCandidate[],
  xyTol: number,
  ambEps: number,
  parallelOffsetMaxM: number,
): {
  best: WallTopCandidate | null;
  bestScore: number;
  secondScore: number;
  ambiguous: boolean;
  matchToleranceUsed: number;
} {
  const samples = [
    { x: ax, y: ay },
    { x: bx, y: by },
    { x: (ax + bx) / 2, y: (ay + by) / 2 },
  ];
  const eax = bx - ax;
  const eay = by - ay;
  const lenE = Math.hypot(eax, eay);

  const scoreForWall = (w: WallTopCandidate): { score: number; tol: number } => {
    const wdx = w.bx - w.ax;
    const wdy = w.by - w.ay;
    const lenW = Math.hypot(wdx, wdy);
    if (lenE < EPS_LEN2 || lenW < EPS_LEN2) {
      let m = 0;
      for (const s of samples) {
        const d = distPointToSegment2D(s.x, s.y, w.ax, w.ay, w.bx, w.by);
        if (d > m) m = d;
      }
      return { score: m, tol: xyTol };
    }
    const dot = Math.abs((eax * wdx + eay * wdy) / (lenE * lenW));
    if (dot >= PARALLEL_DOT_THRESHOLD) {
      let m = 0;
      for (const s of samples) {
        const d = distPointToInfiniteLine2D(s.x, s.y, w.ax, w.ay, w.bx, w.by);
        if (d > m) m = d;
      }
      return { score: m, tol: parallelOffsetMaxM };
    }
    let m = 0;
    for (const s of samples) {
      const d = distPointToSegment2D(s.x, s.y, w.ax, w.ay, w.bx, w.by);
      if (d > m) m = d;
    }
    return { score: m, tol: xyTol };
  };

  let best: WallTopCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondScore = Number.POSITIVE_INFINITY;
  let bestTol = xyTol;
  for (const w of walls) {
    const { score: sc, tol } = scoreForWall(w);
    if (sc < bestScore - 1e-12) {
      secondScore = bestScore;
      bestScore = sc;
      best = w;
      bestTol = tol;
    } else if (sc < secondScore) {
      secondScore = sc;
    }
  }
  if (best == null || bestScore > bestTol) {
    return { best: null, bestScore, secondScore, ambiguous: false, matchToleranceUsed: xyTol };
  }
  const ambiguous =
    Number.isFinite(secondScore) && secondScore <= bestTol && Math.abs(secondScore - bestScore) < ambEps;
  return { best, bestScore, secondScore, ambiguous, matchToleranceUsed: bestTol };
}

function alignedTopSegment(shell: BuildingShell3D, w: WallTopCandidate): readonly [BuildingLocalVec3, BuildingLocalVec3] {
  const pos = new Map<string, BuildingLocalVec3>();
  for (const v of shell.topRing.vertices) {
    pos.set(v.vertexId, v.position);
  }
  const seg = shell.topRing.segments[w.segmentIndex]!;
  const pa = pos.get(seg.vertexIdA)!;
  const pb = pos.get(seg.vertexIdB)!;
  return [pa, pb];
}

function roofSegment3D(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): readonly [BuildingLocalVec3, BuildingLocalVec3] {
  return [
    { x: ax, y: ay, z: az },
    { x: bx, y: by, z: bz },
  ];
}

function maxOutwardOverhang(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: WallTopCandidate,
): number {
  const vals = [
    outwardScalarXY(ax, ay, w.ax, w.ay, w.outwardNx, w.outwardNy),
    outwardScalarXY(bx, by, w.ax, w.ay, w.outwardNx, w.outwardNy),
    outwardScalarXY((ax + bx) / 2, (ay + by) / 2, w.ax, w.ay, w.outwardNx, w.outwardNy),
  ];
  let m = 0;
  for (const v of vals) {
    if (v > m) m = v;
  }
  return m;
}

function minOutwardOverhang(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: WallTopCandidate,
): number {
  const vals = [
    outwardScalarXY(ax, ay, w.ax, w.ay, w.outwardNx, w.outwardNy),
    outwardScalarXY(bx, by, w.ax, w.ay, w.outwardNx, w.outwardNy),
    outwardScalarXY((ax + bx) / 2, (ay + by) / 2, w.ax, w.ay, w.outwardNx, w.outwardNy),
  ];
  return Math.min(...vals);
}

function note(
  code: string,
  message: string,
  topologyEdgeId?: string,
  wallSegmentId?: string,
): RoofBindingDiagnosticNote {
  return { code, message, topologyEdgeId, wallSegmentId };
}

/**
 * Produit le binding logique toiture ↔ bâtiment.
 *
 * Association arête ↔ mur (XY) : pour chaque arête candidate, on évalue la distance max
 * des points échantillons (deux extrémités + milieu) aux segments du `topRing` ; le mur retenu
 * minimise ce score. Aucun snap silencieux : si le score dépasse `wallSegmentXYToleranceM`,
 * `attachedWallSegmentId` reste null et un diagnostic est émis.
 *
 * Écart vertical : `verticalOffsetM = ((z_a+z_b)/2) - shell.topZ` avec `z_*` issus de
 * `evaluateZOnRoofPlane` sur le plan du pan incident (chaîne `solutionSet` uniquement).
 *
 * Alignement vs débord vs incohérence :
 * - `isSnappedToWallTop` si |verticalOffsetM| ≤ `zSnapToleranceM`.
 * - `outwardOverhangM` = max des projections (point − ancrage mur) · n_sortante sur les trois échantillons,
 *   tronquée à max(0,·) pour la métrique « débord extérieur » affichée ; la valeur brute signée
 *   minimum sert à détecter une pénétration intérieure (incohérence).
 * - Débord « intentionnel » (heuristique v1) : `outwardOverhangM ≥ intentionalOverhangThresholdM` avec Z snappé.
 * - Gouttière quasi parallèle au mur : distance perpendiculaire droite-toit ↔ droite-mur (plan XY) avec tolérance
 *   `wallParallelOffsetMaxM` (défaut 1,5 m) pour associer l’arête au mur malgré un débord ; sinon distance point-segment
 *   avec `wallSegmentXYToleranceM`.
 */
export function bindRoofToBuilding(input: BindRoofToBuildingInput): BindRoofToBuildingOutput {
  const zSnap = input.zSnapToleranceM ?? DEFAULT_Z_SNAP;
  const xyTol = input.wallSegmentXYToleranceM ?? DEFAULT_WALL_XY_TOL;
  const overhangIntent = input.intentionalOverhangThresholdM ?? DEFAULT_INTENTIONAL_OVERHANG;
  const ambEps = input.wallMatchAmbiguityEpsilonM ?? DEFAULT_MATCH_AMBIGUITY_EPS;
  const parallelMax = input.wallParallelOffsetMaxM ?? DEFAULT_PARALLEL_OFFSET_MAX;

  const shell = input.shell;
  const graph = input.topologyGraph;
  const solutionSet = input.solutionSet;
  const intersectionSet = input.intersectionSet;

  const errors: string[] = [];
  const warnings: string[] = [];
  const vMap = buildVertexXYMap(graph);
  const byPatch = buildSolutionByPatchId(solutionSet);
  const walls = buildWallTopCandidates(shell);

  if (walls.length === 0) {
    errors.push("BINDING_NO_WALL_TOP_SEGMENTS: coque bâtiment sans segment haut exploitable.");
  }

  const intersectionEntries: RoofBindingIntersectionCrossCheck[] = [];
  let inconsistentIntersection = 0;
  for (const it of intersectionSet.intersections) {
    if (!it.isConsistent) inconsistentIntersection++;
    intersectionEntries.push({
      topologyEdgeId: it.topologyEdgeId,
      leftPatchId: it.leftPatchId,
      rightPatchId: it.rightPatchId,
      intersectionConsistent: it.isConsistent,
      note: it.resolutionMethod,
    });
  }
  if (intersectionSet.diagnostics.sewingLevel === "invalid") {
    warnings.push("BINDING_INTERSECTION_SEWING_INVALID: voir intersectionSet.diagnostics.");
  } else if (intersectionSet.diagnostics.sewingLevel === "ambiguous") {
    warnings.push("BINDING_INTERSECTION_SEWING_AMBIGUOUS: coutures partiellement ambiguës.");
  }

  const eaveBindings: RoofEaveWallBinding[] = [];
  const freeRidgeBindings: RoofFreeRidgeBinding[] = [];
  const gableBindings: RoofGableWallBinding[] = [];
  const overhangs: RoofOverhangBinding[] = [];

  let eaveEdgeCount = 0;
  let correctlyAttachedEaveCount = 0;
  let floatingEaveCount = 0;
  let gableEdgeCount = 0;
  let freeRidgeEdgeCount = 0;
  let overhangDetectionCount = 0;

  let misalignedEdgeCount = 0;
  let unsupportedEdgeCount = 0;
  let floatingEdgeCountDiag = 0;

  for (const edge of graph.edges) {
    if (edge.boundaryStatus !== "boundary") continue;

    const va = vMap.get(edge.vertexTopologyIdA);
    const vb = vMap.get(edge.vertexTopologyIdB);
    if (!va || !vb) {
      errors.push(`BINDING_VERTEX_MISSING_FOR_EDGE:${edge.topologyEdgeId}`);
      continue;
    }

    const plane = pickPlaneForEdge(edge, byPatch);

    if (edge.officialKind === "eave") {
      eaveEdgeCount++;
      const diag: RoofBindingDiagnosticNote[] = [];
      let za = plane ? evaluateZOnRoofPlane(plane, va.x, va.y) : Number.NaN;
      let zb = plane ? evaluateZOnRoofPlane(plane, vb.x, vb.y) : Number.NaN;
      if (!plane) {
        diag.push(
          note("EAVE_PLANE_MISSING", "Aucun plan résolu pour les pans incidents — Z toit non évaluable.", edge.topologyEdgeId),
        );
        errors.push(`BINDING_EAVE_PLANE_MISSING:${edge.topologyEdgeId}`);
        floatingEaveCount++;
        floatingEdgeCountDiag++;
        unsupportedEdgeCount++;
      } else if (!Number.isFinite(za) || !Number.isFinite(zb)) {
        diag.push(note("EAVE_Z_NUMERIC", "Z sur plan non fini (plan quasi vertical ?).", edge.topologyEdgeId));
        errors.push(`BINDING_EAVE_Z_INVALID:${edge.topologyEdgeId}`);
        floatingEaveCount++;
        floatingEdgeCountDiag++;
        unsupportedEdgeCount++;
        za = Number.NaN;
        zb = Number.NaN;
      }

      const roofSeg =
        Number.isFinite(za) && Number.isFinite(zb) ? roofSegment3D(va.x, va.y, za, vb.x, vb.y, zb) : null;
      const zMid = Number.isFinite(za) && Number.isFinite(zb) ? (za + zb) / 2 - shell.topZ : null;
      const snapped = zMid != null && Math.abs(zMid) <= zSnap;

      const {
        best,
        bestScore,
        ambiguous,
        matchToleranceUsed,
      } = matchWallSegment(va.x, va.y, vb.x, vb.y, walls, xyTol, ambEps, parallelMax);

      if (ambiguous) {
        diag.push(
          note(
            "WALL_MATCH_AMBIGUOUS",
            "Plusieurs segments mur à distance comparable — rattachement non tranché.",
            edge.topologyEdgeId,
          ),
        );
        warnings.push(`BINDING_WALL_MATCH_AMBIGUOUS:${edge.topologyEdgeId}`);
      }

      let attachedWallSegmentId: string | null = null;
      let wallIndex: number | null = null;
      let aligned: readonly [BuildingLocalVec3, BuildingLocalVec3] | null = null;
      let outwardOh = 0;
      let inwardWorst = 0;

      if (best && !ambiguous) {
        attachedWallSegmentId = best.segmentId;
        wallIndex = best.segmentIndex;
        aligned = alignedTopSegment(shell, best);
        outwardOh = maxOutwardOverhang(va.x, va.y, vb.x, vb.y, best);
        inwardWorst = minOutwardOverhang(va.x, va.y, vb.x, vb.y, best);
      } else if (best && ambiguous) {
        attachedWallSegmentId = null;
        wallIndex = null;
        aligned = null;
      }

      const xyMax = best && !ambiguous ? bestScore : null;
      const insideTooFar = best && !ambiguous ? inwardWorst < -xyTol : false;
      const geomOk = roofSeg != null;
      const xyAcceptable = best != null && !ambiguous && bestScore <= matchToleranceUsed;
      const isConsistent = geomOk && !ambiguous && best != null && snapped && !insideTooFar && xyAcceptable;

      if (isConsistent) correctlyAttachedEaveCount++;

      const planeOrZFailure = !plane || !Number.isFinite(za) || !Number.isFinite(zb);
      if (planeOrZFailure) {
        /* compteurs flottant / unsupported déjà incrémentés ci-dessus */
      } else if (!best || bestScore > matchToleranceUsed) {
        unsupportedEdgeCount++;
        floatingEaveCount++;
        floatingEdgeCountDiag++;
        diag.push(
          note(
            "EAVE_UNSUPPORTED_NO_WALL",
            "Aucun segment de haut de mur dans la tolérance XY — arête eave non ancrée.",
            edge.topologyEdgeId,
          ),
        );
      } else if (ambiguous) {
        unsupportedEdgeCount++;
        floatingEaveCount++;
        floatingEdgeCountDiag++;
      } else if (!snapped) {
        misalignedEdgeCount++;
        diag.push(
          note(
            "EAVE_Z_MISALIGNED",
            `Écart vertical moyen |Δz|=${zMid != null ? Math.abs(zMid).toFixed(4) : "?"} m vs topZ.`,
            edge.topologyEdgeId,
            attachedWallSegmentId ?? undefined,
          ),
        );
      } else if (insideTooFar) {
        misalignedEdgeCount++;
        diag.push(
          note(
            "EAVE_INSIDE_BUILDING_PLAN",
            "Projection intérieure forte vs normale mur — géométrie incohérente ou mauvais mur.",
            edge.topologyEdgeId,
            attachedWallSegmentId ?? undefined,
          ),
        );
      }

      if (outwardOh > EPS_Z) overhangDetectionCount++;
      let intent: RoofOverhangIntentFlag = "none";
      if (outwardOh >= overhangIntent && snapped) intent = "likely_intentional";
      else if (outwardOh >= overhangIntent && !snapped) intent = "ambiguous";
      else if (outwardOh > EPS_Z && !snapped) intent = "inconsistent_geometry";
      const ohConsistent = snapped && !insideTooFar && !ambiguous && best != null && bestScore <= matchToleranceUsed;
      overhangs.push({
        topologyEdgeId: edge.topologyEdgeId,
        context: "eave",
        overhangDistanceM: outwardOh,
        isIntentional: intent,
        isConsistent: outwardOh <= EPS_Z ? isConsistent : ohConsistent,
        diagnostics: [
          note(
            outwardOh > EPS_Z ? "OVERHANG_METRIC" : "OVERHANG_NONE",
            outwardOh > EPS_Z
              ? "Débord mesuré selon normale sortante du mur retenu (échantillons extrémités + milieu)."
              : "Pas de débord extérieur mesuré au-delà du seuil numérique.",
            edge.topologyEdgeId,
            attachedWallSegmentId ?? undefined,
          ),
        ],
      });

      eaveBindings.push({
        topologyEdgeId: edge.topologyEdgeId,
        attachedWallSegmentId,
        attachedWallSegmentIndex: wallIndex,
        alignedSegment3D: aligned,
        roofEdgeSegment3D: roofSeg,
        verticalOffsetM: zMid,
        isSnappedToWallTop: snapped ?? false,
        xyMaxDistanceToWallSegmentM: xyMax,
        outwardOverhangM: outwardOh,
        isConsistent,
        diagnostics: diag,
      });
      continue;
    }

    if (edge.officialKind === "gable") {
      gableEdgeCount++;
      const diag: RoofBindingDiagnosticNote[] = [];
      let za = plane ? evaluateZOnRoofPlane(plane, va.x, va.y) : Number.NaN;
      let zb = plane ? evaluateZOnRoofPlane(plane, vb.x, vb.y) : Number.NaN;
      if (!plane || !Number.isFinite(za) || !Number.isFinite(zb)) {
        diag.push(note("GABLE_PLANE_OR_Z", "Plan ou Z pignon non résolu.", edge.topologyEdgeId));
        if (!plane) errors.push(`BINDING_GABLE_PLANE_MISSING:${edge.topologyEdgeId}`);
      }
      const roofSeg =
        Number.isFinite(za) && Number.isFinite(zb) ? roofSegment3D(va.x, va.y, za, vb.x, vb.y, zb) : null;
      const zMin = Number.isFinite(za) && Number.isFinite(zb) ? Math.min(za, zb) - shell.topZ : null;
      const zSpan = Number.isFinite(za) && Number.isFinite(zb) ? Math.abs(za - zb) : null;

      const { best, bestScore, ambiguous, matchToleranceUsed } = matchWallSegment(
        va.x,
        va.y,
        vb.x,
        vb.y,
        walls,
        xyTol,
        ambEps,
        parallelMax,
      );
      let attachedWallSegmentId: string | null = null;
      let wallIndex: number | null = null;
      let aligned: readonly [BuildingLocalVec3, BuildingLocalVec3] | null = null;
      let support: RoofRidgeSupportStatus = "floating";
      if (ambiguous) {
        support = "ambiguous_support";
        warnings.push(`BINDING_GABLE_WALL_AMBIGUOUS:${edge.topologyEdgeId}`);
      } else if (best && bestScore <= matchToleranceUsed) {
        attachedWallSegmentId = best.segmentId;
        wallIndex = best.segmentIndex;
        aligned = alignedTopSegment(shell, best);
        support = "wall_supported";
      }

      if (support === "floating" || support === "ambiguous_support") unsupportedEdgeCount++;

      const closureOk =
        support === "wall_supported" &&
        !ambiguous &&
        zMin != null &&
        Math.abs(zMin) <= zSnap &&
        roofSeg != null;

      if (!closureOk && roofSeg) {
        diag.push(
          note(
            "GABLE_CLOSURE_CHECK",
            "Fermeture pignon : min(Z) vs topZ et alignement XY mur.",
            edge.topologyEdgeId,
            attachedWallSegmentId ?? undefined,
          ),
        );
      }

      const outwardOh = best && !ambiguous ? maxOutwardOverhang(va.x, va.y, vb.x, vb.y, best) : 0;
      if (outwardOh > EPS_Z) {
        overhangDetectionCount++;
        overhangs.push({
          topologyEdgeId: edge.topologyEdgeId,
          context: "gable",
          overhangDistanceM: outwardOh,
          isIntentional: outwardOh >= overhangIntent ? "ambiguous" : "none",
          isConsistent: closureOk,
          diagnostics: [note("GABLE_OVERHANG", "Saillie en plan au droit du mur pignon.", edge.topologyEdgeId)],
        });
      }

      gableBindings.push({
        topologyEdgeId: edge.topologyEdgeId,
        classification: "gable",
        attachedWallSegmentId,
        attachedWallSegmentIndex: wallIndex,
        alignedSegment3D: aligned,
        roofEdgeSegment3D: roofSeg,
        minZOffsetFromWallTopM: zMin,
        verticalSpanAlongEdgeM: zSpan,
        isWallClosureGeometricallyConsistent: closureOk,
        diagnostics: diag,
      });
      continue;
    }

    if (edge.officialKind === "ridge" || edge.officialKind === "hip" || edge.officialKind === "valley" || edge.officialKind === "internal") {
      freeRidgeEdgeCount++;
      const diag: RoofBindingDiagnosticNote[] = [];
      let za = plane ? evaluateZOnRoofPlane(plane, va.x, va.y) : Number.NaN;
      let zb = plane ? evaluateZOnRoofPlane(plane, vb.x, vb.y) : Number.NaN;
      const roofSeg =
        Number.isFinite(za) && Number.isFinite(zb) ? roofSegment3D(va.x, va.y, za, vb.x, vb.y, zb) : null;

      const { best, bestScore, ambiguous, matchToleranceUsed } = matchWallSegment(
        va.x,
        va.y,
        vb.x,
        vb.y,
        walls,
        xyTol,
        ambEps,
        parallelMax,
      );
      let attachedWallSegmentId: string | null = null;
      let support: RoofRidgeSupportStatus = "floating";
      if (ambiguous) support = "ambiguous_support";
      else if (best && bestScore <= matchToleranceUsed) {
        attachedWallSegmentId = best.segmentId;
        support = "wall_supported";
      }

      freeRidgeBindings.push({
        topologyEdgeId: edge.topologyEdgeId,
        classification: "free_edge",
        supportStatus: support,
        attachedWallSegmentId,
        roofEdgeSegment3D: roofSeg,
        diagnostics: diag,
      });
    }
  }

  const structuralProof: RoofBindingStructuralProof = {
    eaveEdgeCount,
    correctlyAttachedEaveCount,
    floatingEaveCount,
    gableEdgeCount,
    freeRidgeEdgeCount,
    overhangDetectionCount,
  };

  let bindingConsistencyLevel: RoofBuildingBindingDiagnostics["bindingConsistencyLevel"] = "clean";
  if (errors.length > 0 || walls.length === 0) {
    bindingConsistencyLevel = "invalid";
  } else if (floatingEaveCount > 0) {
    bindingConsistencyLevel = "invalid";
  } else if (misalignedEdgeCount > 0 || inconsistentIntersection > 0) {
    bindingConsistencyLevel = "partial";
  }
  if (
    bindingConsistencyLevel === "clean" &&
    (warnings.some((w) => w.includes("AMBIGUOUS")) || intersectionSet.diagnostics.sewingLevel === "ambiguous")
  ) {
    bindingConsistencyLevel = "ambiguous";
  } else if (
    bindingConsistencyLevel === "clean" &&
    (unsupportedEdgeCount > 0 || intersectionSet.diagnostics.sewingLevel === "partial")
  ) {
    bindingConsistencyLevel = "partial";
  }

  const isValid = errors.length === 0 && walls.length > 0;
  const allGablesClosed =
    gableBindings.length === 0 || gableBindings.every((g) => g.isWallClosureGeometricallyConsistent);
  const roofAttachedToBuilding =
    isValid &&
    eaveEdgeCount > 0 &&
    floatingEaveCount === 0 &&
    misalignedEdgeCount === 0 &&
    unsupportedEdgeCount === 0 &&
    inconsistentIntersection === 0 &&
    eaveEdgeCount === correctlyAttachedEaveCount &&
    allGablesClosed;

  const diagnostics: RoofBuildingBindingDiagnostics = {
    isValid,
    roofAttachedToBuilding,
    attachedEdgeCount: correctlyAttachedEaveCount,
    floatingEdgeCount: floatingEdgeCountDiag,
    misalignedEdgeCount,
    unsupportedEdgeCount,
    overhangCount: overhangDetectionCount,
    gableEdgeCount,
    bindingConsistencyLevel,
    errors,
    warnings,
    structuralProof,
    intersectionCrossCheckSummary: {
      inconsistentSharedEdgeCount: inconsistentIntersection,
      entries: intersectionEntries,
    },
  };

  const binding: RoofBuildingBindingResult = {
    schemaId: ROOF_BUILDING_BINDING_SCHEMA_ID,
    eaveBindings,
    freeRidgeBindings,
    gableBindings,
    overhangs,
    diagnostics,
  };

  return { binding };
}
