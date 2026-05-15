/**
 * Moteur officiel des intersections 3D entre pans toiture.
 * Entrées : canonique + graphe topologique + `RoofPlaneSolutionSet` uniquement.
 * Interdit : CALPINAGE_STATE, window, chemins legacy.
 *
 * @see docs/architecture/roof-plane-intersections.md
 */

import type { BuildingLocalVec3 } from "../model/canonicalHouse3DModel";
import type { RoofPlaneEquation } from "../model/roofPlaneSolutionModel";
import type {
  ComputeRoofPlaneIntersectionsInput,
  ComputeRoofPlaneIntersectionsResult,
  RoofIntersectionLine3D,
  RoofIntersectionResolutionMethod,
  RoofIntersectionSet,
  RoofIntersectionSetDiagnostics,
  RoofSeamingLevel,
  RoofSharedEdgeIntersection,
} from "../model/roofIntersectionModel";
import {
  ROOF_INTERSECTION_SET_SCHEMA_ID,
  intersectImplicitPlanes,
} from "../model/roofIntersectionModel";
import type { RoofTopologyGraphEdge } from "../model/roofTopologyModel";
import { evaluateZOnRoofPlane } from "./solveRoofPlanes";

const DEFAULT_XY_ALIGN = 0.02;
const DEFAULT_STEP = 0.02;
const DEFAULT_GAP = 0.02;
const DEFAULT_PARALLEL_CROSS = 1e-6;
const DEFAULT_SEGMENT_SLACK = 0.03;

function dist2(a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dist3(a: BuildingLocalVec3, b: BuildingLocalVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dot2(a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): number {
  return a.x * b.x + a.y * b.y;
}

function dot3(a: BuildingLocalVec3, b: BuildingLocalVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub3(a: BuildingLocalVec3, b: BuildingLocalVec3): BuildingLocalVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function maxStepAlongEdgeXY(
  eq1: RoofPlaneEquation,
  eq2: RoofPlaneEquation,
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
): number {
  const samples: Readonly<{ x: number; y: number }>[] = [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
  let m = 0;
  for (const p of samples) {
    const z1 = evaluateZOnRoofPlane(eq1, p.x, p.y);
    const z2 = evaluateZOnRoofPlane(eq2, p.x, p.y);
    if (!Number.isFinite(z1) || !Number.isFinite(z2)) continue;
    m = Math.max(m, Math.abs(z1 - z2));
  }
  return m;
}

function patchPairs(incidentPatchIds: readonly string[]): readonly (readonly [string, string])[] {
  const u = [...new Set(incidentPatchIds)].sort((x, y) => x.localeCompare(y));
  const out: (readonly [string, string])[] = [];
  for (let i = 0; i < u.length; i++) {
    for (let j = i + 1; j < u.length; j++) {
      out.push([u[i]!, u[j]!]);
    }
  }
  return out;
}

function buildIntersectionForPair(
  edge: RoofTopologyGraphEdge,
  leftPatchId: string,
  rightPatchId: string,
  eq1: RoofPlaneEquation,
  eq2: RoofPlaneEquation,
  aXY: Readonly<{ x: number; y: number }>,
  bXY: Readonly<{ x: number; y: number }>,
  edgeLengthM: number,
  parallelCrossTol: number,
  xyTol: number,
  stepTol: number,
  gapTol: number,
  segmentSlack: number,
): RoofSharedEdgeIntersection {
  const errs: string[] = [];
  const warns: string[] = [];

  if (edgeLengthM < 1e-9) {
    return {
      topologyEdgeId: edge.topologyEdgeId,
      leftPatchId,
      rightPatchId,
      officialEdgeKind: edge.officialKind,
      intersectionLine3D: null,
      sharedSegment3D: null,
      segmentStart3D: null,
      segmentEnd3D: null,
      resolutionMethod: "unresolved_topology_edge_degenerate",
      isConsistent: false,
      hasGap: true,
      hasStep: false,
      hasOverlap: false,
      isClipped: false,
      gapDistanceM: Number.POSITIVE_INFINITY,
      stepDistanceM: 0,
      overlapDistanceM: 0,
      toleranceUsed: {
        xyAlignmentM: xyTol,
        stepM: stepTol,
        gapM: gapTol,
        parallelCrossM: parallelCrossTol,
      },
      conflicts: ["TOPOLOGY_EDGE_ZERO_LENGTH"],
      diagnostics: { errors: errs, warnings: warns },
    };
  }

  const ray = intersectImplicitPlanes(eq1, eq2, parallelCrossTol);
  const toleranceUsed = {
    xyAlignmentM: xyTol,
    stepM: stepTol,
    gapM: gapTol,
    parallelCrossM: parallelCrossTol,
  };

  if (!ray.ok) {
    if (ray.reason === "coincident") {
      return {
        topologyEdgeId: edge.topologyEdgeId,
        leftPatchId,
        rightPatchId,
        officialEdgeKind: edge.officialKind,
        intersectionLine3D: null,
        sharedSegment3D: null,
        segmentStart3D: null,
        segmentEnd3D: null,
        resolutionMethod: "unresolved_coincident_planes",
        isConsistent: false,
        hasGap: false,
        hasStep: false,
        hasOverlap: true,
        isClipped: false,
        gapDistanceM: 0,
        stepDistanceM: maxStepAlongEdgeXY(eq1, eq2, aXY, bXY),
        overlapDistanceM: 1,
        toleranceUsed,
        conflicts: ["PLANES_COINCIDENT_OR_NEAR_COINCIDENT"],
        diagnostics: { errors: errs, warnings: warns },
      };
    }
    return {
      topologyEdgeId: edge.topologyEdgeId,
      leftPatchId,
      rightPatchId,
      officialEdgeKind: edge.officialKind,
      intersectionLine3D: null,
      sharedSegment3D: null,
      segmentStart3D: null,
      segmentEnd3D: null,
      resolutionMethod: "unresolved_parallel_planes",
      isConsistent: false,
      hasGap: false,
      hasStep: false,
      hasOverlap: false,
      isClipped: false,
      gapDistanceM: 0,
      stepDistanceM: maxStepAlongEdgeXY(eq1, eq2, aXY, bXY),
      overlapDistanceM: 0,
      toleranceUsed,
      conflicts: ["PLANES_PARALLEL_NO_LINE"],
      diagnostics: { errors: errs, warnings: warns },
    };
  }

  const { anchorPoint: p0, directionUnit: dir } = ray;
  const stepDistanceM = maxStepAlongEdgeXY(eq1, eq2, aXY, bXY);

  let resolutionMethod: RoofIntersectionResolutionMethod = "two_plane_line_clip_topology_edge_xy";
  const uxy = { x: dir.x, y: dir.y };
  if (dot2(uxy, uxy) < 1e-16) {
    resolutionMethod = "vertical_intersection_line_xy_degenerate";
  }

  const intersectionLine3D: RoofIntersectionLine3D = { anchorPoint: { ...p0 }, directionUnit: { ...dir } };

  const zA1 = evaluateZOnRoofPlane(eq1, aXY.x, aXY.y);
  const zA2 = evaluateZOnRoofPlane(eq2, aXY.x, aXY.y);
  const zB1 = evaluateZOnRoofPlane(eq1, bXY.x, bXY.y);
  const zB2 = evaluateZOnRoofPlane(eq2, bXY.x, bXY.y);
  const qA: BuildingLocalVec3 = { x: aXY.x, y: aXY.y, z: (zA1 + zA2) / 2 };
  const qB: BuildingLocalVec3 = { x: bXY.x, y: bXY.y, z: (zB1 + zB2) / 2 };
  const tA = dot3(sub3(qA, p0), dir);
  const tB = dot3(sub3(qB, p0), dir);

  const pa = { x: p0.x + tA * dir.x, y: p0.y + tA * dir.y };
  const pb = { x: p0.x + tB * dir.x, y: p0.y + tB * dir.y };
  const gapDistanceM = Math.max(dist2(pa, aXY), dist2(pb, bXY));

  const tLo = Math.min(tA, tB);
  const tHi = Math.max(tA, tB);
  const segStart: BuildingLocalVec3 = {
    x: p0.x + tLo * dir.x,
    y: p0.y + tLo * dir.y,
    z: p0.z + tLo * dir.z,
  };
  const segEnd: BuildingLocalVec3 = {
    x: p0.x + tHi * dir.x,
    y: p0.y + tHi * dir.y,
    z: p0.z + tHi * dir.z,
  };
  const segLen = dist3(segStart, segEnd);
  const isClipped = segLen + segmentSlack < edgeLengthM;
  if (isClipped) warns.push("INTERSECTION_SEGMENT_SHORTER_THAN_TOPOLOGY_EDGE");

  const hasGap = gapDistanceM > gapTol;
  const hasStep = stepDistanceM > stepTol;
  const hasOverlap = false;
  const overlapDistanceM = 0;

  const planeTol = 5e-3;
  for (const pt of [segStart, segEnd]) {
    const e1 = Math.abs(
      eq1.normal.x * pt.x + eq1.normal.y * pt.y + eq1.normal.z * pt.z + eq1.d,
    );
    const e2 = Math.abs(
      eq2.normal.x * pt.x + eq2.normal.y * pt.y + eq2.normal.z * pt.z + eq2.d,
    );
    if (e1 > planeTol || e2 > planeTol) errs.push("SEGMENT_ENDPOINT_OFF_PLANE_NUMERIC");
  }

  const isConsistent = !hasGap && !hasStep && !hasOverlap && errs.length === 0;

  return {
    topologyEdgeId: edge.topologyEdgeId,
    leftPatchId,
    rightPatchId,
    officialEdgeKind: edge.officialKind,
    intersectionLine3D,
    sharedSegment3D: [segStart, segEnd],
    segmentStart3D: segStart,
    segmentEnd3D: segEnd,
    resolutionMethod,
    isConsistent,
    hasGap,
    hasStep,
    hasOverlap,
    isClipped,
    gapDistanceM,
    stepDistanceM,
    overlapDistanceM,
    toleranceUsed,
    conflicts: errs.length ? errs : [],
    diagnostics: { errors: errs, warnings: warns },
  };
}

/**
 * Calcule les intersections 3D (droite théorique + segment utile) pour chaque paire de pans
 * voisins le long d’une arête topologique **partagée** (`boundaryStatus === "shared"`).
 */
export function computeRoofPlaneIntersections(
  input: ComputeRoofPlaneIntersectionsInput,
): ComputeRoofPlaneIntersectionsResult {
  const {
    topologyGraph,
    solutionSet,
    document,
    xyAlignmentToleranceM = DEFAULT_XY_ALIGN,
    stepToleranceM = DEFAULT_STEP,
    gapToleranceM = DEFAULT_GAP,
    parallelCrossTolerance = DEFAULT_PARALLEL_CROSS,
    segmentLengthSlackM = DEFAULT_SEGMENT_SLACK,
  } = input;

  const xyTol = Math.min(xyAlignmentToleranceM, gapToleranceM);
  const stepTol = stepToleranceM;
  const gapTol = gapToleranceM;

  const solByPatch = new Map(solutionSet.solutions.map((s) => [s.roofPatchId, s] as const));
  const vertexByTopo = new Map(topologyGraph.vertices.map((v) => [v.topologyVertexId, v] as const));

  const intersections: RoofSharedEdgeIntersection[] = [];
  const globalErrors: string[] = [];
  const globalWarnings: string[] = [];

  if (document.roof.topology.roofId !== topologyGraph.roofId) {
    globalWarnings.push("ROOF_ID_MISMATCH_DOCUMENT_GRAPH");
  }

  let sharedTopologyEdgeCount = 0;
  let computedIntersectionCount = 0;
  let validIntersectionCount = 0;
  let ambiguousIntersectionCount = 0;
  let gapCount = 0;
  let stepCount = 0;
  let overlapCount = 0;
  let parallelPlaneCount = 0;
  let unresolvedNeighborPairCount = 0;

  for (const edge of topologyGraph.edges) {
    if (edge.boundaryStatus !== "shared") continue;
    if (edge.incidentPatchIds.length < 2) continue;
    sharedTopologyEdgeCount++;

    const va = vertexByTopo.get(edge.vertexTopologyIdA);
    const vb = vertexByTopo.get(edge.vertexTopologyIdB);
    if (!va || !vb) {
      globalErrors.push(`INTERSECTION_MISSING_TOPOLOGY_VERTEX:${edge.topologyEdgeId}`);
      unresolvedNeighborPairCount++;
      continue;
    }
    const aXY = va.positionXY;
    const bXY = vb.positionXY;

    for (const [leftPatchId, rightPatchId] of patchPairs(edge.incidentPatchIds)) {
      computedIntersectionCount++;
      const s1 = solByPatch.get(leftPatchId);
      const s2 = solByPatch.get(rightPatchId);
      const eq1 = s1?.planeEquation ?? null;
      const eq2 = s2?.planeEquation ?? null;

      if (!eq1 || !eq2) {
        unresolvedNeighborPairCount++;
        intersections.push({
          topologyEdgeId: edge.topologyEdgeId,
          leftPatchId,
          rightPatchId,
          officialEdgeKind: edge.officialKind,
          intersectionLine3D: null,
          sharedSegment3D: null,
          segmentStart3D: null,
          segmentEnd3D: null,
          resolutionMethod: "unresolved_one_or_both_planes_missing",
          isConsistent: false,
          hasGap: false,
          hasStep: false,
          hasOverlap: false,
          isClipped: false,
          gapDistanceM: 0,
          stepDistanceM: 0,
          overlapDistanceM: 0,
          toleranceUsed: {
            xyAlignmentM: xyTol,
            stepM: stepTol,
            gapM: gapTol,
            parallelCrossM: parallelCrossTolerance,
          },
          conflicts: ["ONE_OR_BOTH_PATCH_PLANES_UNRESOLVED"],
          diagnostics: { errors: [], warnings: [] },
        });
        continue;
      }

      if (edge.kindMergeAmbiguous) ambiguousIntersectionCount++;

      const item = buildIntersectionForPair(
        edge,
        leftPatchId,
        rightPatchId,
        eq1,
        eq2,
        aXY,
        bXY,
        edge.lengthM,
        parallelCrossTolerance,
        xyTol,
        stepTol,
        gapTol,
        segmentLengthSlackM,
      );

      intersections.push(item);
      if (item.isConsistent) validIntersectionCount++;
      if (item.hasGap) gapCount++;
      if (item.hasStep) stepCount++;
      if (item.hasOverlap) overlapCount++;
      if (
        item.resolutionMethod === "unresolved_parallel_planes" ||
        item.resolutionMethod === "unresolved_coincident_planes"
      ) {
        parallelPlaneCount++;
      }
      if (!item.isConsistent) unresolvedNeighborPairCount++;

      globalWarnings.push(...item.diagnostics.warnings);
    }
  }

  const invalid = intersections.filter((x) => !x.isConsistent).length;
  const hasGaps = gapCount > 0;
  const hasSteps = stepCount > 0;
  const hasOverlaps = overlapCount > 0;
  let sewingLevel: RoofSeamingLevel = "clean";
  if (computedIntersectionCount > 0 && validIntersectionCount === 0) {
    sewingLevel = "invalid";
  } else if (topologyGraph.diagnostics.topologyBuildabilityLevel === "ambiguous") {
    sewingLevel = "ambiguous";
  } else if (hasGaps || hasSteps || hasOverlaps) {
    sewingLevel = "partial";
  }

  const isValid = invalid === 0 && globalErrors.length === 0;

  const diagnostics: RoofIntersectionSetDiagnostics = {
    isValid,
    sewingLevel,
    sharedTopologyEdgeCount,
    computedIntersectionCount,
    validIntersectionCount,
    ambiguousIntersectionCount,
    gapCount,
    stepCount,
    overlapCount,
    parallelPlaneCount,
    unresolvedNeighborPairCount,
    errors: globalErrors,
    warnings: [...new Set(globalWarnings)],
  };

  const intersectionSet: RoofIntersectionSet = {
    schemaId: ROOF_INTERSECTION_SET_SCHEMA_ID,
    intersections,
    diagnostics,
  };

  return { intersectionSet };
}
