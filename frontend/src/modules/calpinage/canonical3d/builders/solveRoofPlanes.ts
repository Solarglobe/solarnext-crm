/**
 * Solveur officiel des plans toiture — moindres carrés sur hauteurs traçables du canonique.
 * Aucun CALPINAGE_STATE, window, fitPlane / getHeightAtXY / unify / impose / anti-spike legacy.
 *
 * @see docs/architecture/roof-plane-solver.md
 */

import type { CanonicalHouseDocument, HeightProvenance } from "../model/canonicalHouse3DModel";
import type { BuildingLocalVec3 } from "../model/canonicalHouse3DModel";
import type { RoofTopologyGraph } from "../model/roofTopologyModel";
import type {
  HeightConstraintUsed,
  RoofPatchPlaneSolution,
  RoofPlaneEquation,
  RoofPlaneSolutionSet,
  RoofPlaneSolutionSetDiagnostics,
  SolveRoofPlanesInput,
  SolveRoofPlanesResult,
  TopologyConstraintRef,
} from "../model/roofPlaneSolutionModel";
import { ROOF_PLANE_SOLUTION_SET_SCHEMA_ID } from "../model/roofPlaneSolutionModel";

const EPS_Z_DENOM = 1e-9;
const EPS_COLLINEAR_AREA = 1e-12;
const DEFAULT_RESIDUAL_TOL = 0.02;

const PRIMARY: ReadonlySet<HeightProvenance> = new Set(["user_input", "business_rule"]);

function isPrimaryProv(p: HeightProvenance): boolean {
  return PRIMARY.has(p);
}

function resolveVertexHeight(
  document: CanonicalHouseDocument,
  vertexId: string,
): { z: number; quantityId: string; provenance: HeightProvenance } | null {
  const v = document.roof.topology.vertices.find((x) => x.vertexId === vertexId);
  if (!v?.heightQuantityId) return null;
  const hid = v.heightQuantityId;
  const hm = document.heightModel;
  if (hm.zBase.id === hid) {
    return { z: hm.zBase.valueM, quantityId: hid, provenance: hm.zBase.provenance };
  }
  const q = hm.quantities.find((x) => x.id === hid);
  if (!q) return null;
  return { z: q.valueM, quantityId: hid, provenance: q.provenance };
}

/** z = -(n·(x,y,0) + d) / n_z — équivalent à plan implicite. */
export function evaluateZOnRoofPlane(equation: RoofPlaneEquation, x: number, y: number): number {
  const { normal: n, d } = equation;
  if (Math.abs(n.z) < EPS_Z_DENOM) return Number.NaN;
  return -(n.x * x + n.y * y + d) / n.z;
}

function equationFromExplicitZ(a: number, b: number, c: number): RoofPlaneEquation {
  const nx = -a;
  const ny = -b;
  const nz = 1;
  const len = Math.hypot(nx, ny, nz);
  let normal: BuildingLocalVec3 = { x: nx / len, y: ny / len, z: nz / len };
  let d = -normal.z * c;
  if (normal.z < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    d = -d;
  }
  return { normal, d };
}

function signedAreaXY2(p: ReadonlyArray<Readonly<{ x: number; y: number }>>): number {
  let s = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const u = p[i]!;
    const v = p[(i + 1) % n]!;
    s += u.x * v.y - v.x * u.y;
  }
  return s / 2;
}

function fitLeastSquaresPlane(points: readonly Readonly<{ x: number; y: number; z: number }>[]): {
  a: number;
  b: number;
  c: number;
} | null {
  if (points.length < 3) return null;
  let sxx = 0;
  let sxy = 0;
  let sx = 0;
  let syy = 0;
  let sy = 0;
  let n = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (const p of points) {
    sxx += p.x * p.x;
    sxy += p.x * p.y;
    sx += p.x;
    syy += p.y * p.y;
    sy += p.y;
    n++;
    sxz += p.x * p.z;
    syz += p.y * p.z;
    sz += p.z;
  }
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [sxz, syz, sz];
  const beta = solve3x3Symmetric(A, rhs);
  if (!beta) return null;
  return { a: beta[0]!, b: beta[1]!, c: beta[2]! };
}

function solve3x3Symmetric(A: number[][], rhs: number[]): [number, number, number] | null {
  const M = [
    [...A[0]!, rhs[0]!],
    [...A[1]!, rhs[1]!],
    [...A[2]!, rhs[2]!],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-14) return null;
    const tmp = M[col]!;
    M[col] = M[pivot]!;
    M[pivot] = tmp;
    const div = M[col]![col]!;
    for (let j = col; j < 4; j++) M[col]![j]! /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let j = col; j < 4; j++) M[r]![j]! -= f * M[col]![j]!;
    }
  }
  return [M[0]![3]!, M[1]![3]!, M[2]![3]!];
}

function graphEdgeBetween(graph: RoofTopologyGraph, tvA: string, tvB: string) {
  return graph.edges.find(
    (e) =>
      (e.vertexTopologyIdA === tvA && e.vertexTopologyIdB === tvB) ||
      (e.vertexTopologyIdA === tvB && e.vertexTopologyIdB === tvA),
  );
}

function collectTopologyHints(
  graph: RoofTopologyGraph,
  patchId: string,
  boundaryTv: readonly string[],
): TopologyConstraintRef[] {
  const hints: TopologyConstraintRef[] = [];
  const n = boundaryTv.length;
  for (let i = 0; i < n; i++) {
    const a = boundaryTv[i]!;
    const b = boundaryTv[(i + 1) % n]!;
    const ge = graphEdgeBetween(graph, a, b);
    if (ge) {
      hints.push({
        topologyEdgeId: ge.topologyEdgeId,
        officialKind: ge.officialKind,
        note: `boundary_segment:${ge.officialKind}`,
      });
    }
  }
  for (const sc of graph.structuralConstraints) {
    if (sc.kind === "roof_to_building" && sc.roofPatchIds?.includes(patchId)) {
      hints.push({ note: `structural:${sc.kind}:${sc.constraintId}` });
    }
    if (
      (sc.kind === "ridge_segment" || sc.kind === "trait_segment") &&
      sc.topologyEdgeIds.length > 0
    ) {
      const touches = boundaryTv.some((tv) =>
        graph.edges.some(
          (e) =>
            sc.topologyEdgeIds.includes(e.topologyEdgeId) &&
            (e.vertexTopologyIdA === tv || e.vertexTopologyIdB === tv),
        ),
      );
      if (touches) {
        hints.push({
          topologyEdgeId: sc.topologyEdgeIds[0],
          note: `structural:${sc.kind}:${sc.constraintId}`,
        });
      }
    }
  }
  return hints;
}

/**
 * Résout les plans de tous les pans exploitables du graphe (statut `ok`).
 */
export function solveRoofPlanes(input: SolveRoofPlanesInput): SolveRoofPlanesResult {
  const tol = input.residualToleranceM ?? DEFAULT_RESIDUAL_TOL;
  const allowSecondary = input.allowSecondaryHeightProvenance !== false;
  const { document, topologyGraph } = input;

  const globalErrors: string[] = [];
  const globalWarnings: string[] = [];

  if (!topologyGraph.diagnostics.isValid) {
    globalWarnings.push("TOPOLOGY_GRAPH_NOT_VALID:solver_proceeds_with_caution");
  }

  const solutions: RoofPatchPlaneSolution[] = [];
  let solvedPatchCount = 0;
  let fullyConstrainedPatchCount = 0;
  let partialPatchCount = 0;
  let fallbackPatchCount = 0;
  let ambiguousPatchCount = 0;
  let invalidPatchCount = 0;
  let constraintConflictCount = 0;

  for (const gp of topologyGraph.patches) {
    const patchId = gp.roofPatchId;
    const docPatch = document.roof.topology.patches.find((p) => p.roofPatchId === patchId);

    const missing: string[] = [];
    const conflicts: string[] = [];

    if (gp.status !== "ok") {
      invalidPatchCount++;
      solutions.push({
        roofPatchId: patchId,
        planeEquation: null,
        planeNormal: null,
        explicitZ: null,
        solvedVertices3D: null,
        supportConstraintsUsed: [],
        topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
        resolutionMethod: "skipped_topology_invalid",
        resolutionConfidence: "none",
        isFullyConstrained: false,
        isFallbackUsed: false,
        maxResidualM: null,
        diagnostics: { missingConstraints: ["topology_patch_not_ok"], conflicts: [] },
      });
      continue;
    }

    if (!docPatch || docPatch.boundaryVertexIds.length !== gp.boundaryTopologyVertexIds.length) {
      invalidPatchCount++;
      globalErrors.push(`PATCH_DOC_GRAPH_MISMATCH:${patchId}`);
      solutions.push({
        roofPatchId: patchId,
        planeEquation: null,
        planeNormal: null,
        explicitZ: null,
        solvedVertices3D: null,
        supportConstraintsUsed: [],
        topologyHintsUsed: [],
        resolutionMethod: "skipped_topology_invalid",
        resolutionConfidence: "none",
        isFullyConstrained: false,
        isFallbackUsed: false,
        maxResidualM: null,
        diagnostics: {
          missingConstraints: ["canonical_patch_boundary_mismatch"],
          conflicts: [],
        },
      });
      continue;
    }

    if (gp.neighbors.some((n) => n.ambiguity !== "none")) {
      ambiguousPatchCount++;
      globalWarnings.push(`PATCH_NEIGHBOR_AMBIGUITY:${patchId}`);
    }

    const xyRing = docPatch.boundaryVertexIds.map((vid) => {
      const vx = document.roof.topology.vertices.find((v) => v.vertexId === vid);
      return vx ? { x: vx.positionXY.x, y: vx.positionXY.y } : { x: NaN, y: NaN };
    });

    if (Math.abs(signedAreaXY2(xyRing)) < EPS_COLLINEAR_AREA) {
      invalidPatchCount++;
      conflicts.push("FOOTPRINT_XY_DEGENERATE");
      solutions.push({
        roofPatchId: patchId,
        planeEquation: null,
        planeNormal: null,
        explicitZ: null,
        solvedVertices3D: null,
        supportConstraintsUsed: [],
        topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
        resolutionMethod: "unresolved_under_constrained",
        resolutionConfidence: "none",
        isFullyConstrained: false,
        isFallbackUsed: false,
        maxResidualM: null,
        diagnostics: { missingConstraints: [], conflicts },
      });
      continue;
    }

    type Sample = { x: number; y: number; z: number; vertexId: string; quantityId: string; prov: HeightProvenance };
    const primarySamples: Sample[] = [];
    const secondarySamples: Sample[] = [];

    for (const vid of docPatch.boundaryVertexIds) {
      const rh = resolveVertexHeight(document, vid);
      if (!rh) {
        missing.push(`NO_HEIGHT_FOR_VERTEX:${vid}`);
        continue;
      }
      const vx = document.roof.topology.vertices.find((v) => v.vertexId === vid)!;
      const s: Sample = {
        x: vx.positionXY.x,
        y: vx.positionXY.y,
        z: rh.z,
        vertexId: vid,
        quantityId: rh.quantityId,
        prov: rh.provenance,
      };
      if (isPrimaryProv(rh.provenance)) {
        primarySamples.push(s);
      } else {
        secondarySamples.push(s);
      }
    }

    let usedConstraints: HeightConstraintUsed[] = [];
    let fitPoints: Sample[] = [];
    let method: RoofPatchPlaneSolution["resolutionMethod"] = "least_squares_z_equals_ax_plus_by_plus_c_primary_heights";
    let fallbackUsed = false;

    if (primarySamples.length >= 3) {
      fitPoints = primarySamples;
      usedConstraints = primarySamples.map((s) => ({
        vertexId: s.vertexId,
        heightQuantityId: s.quantityId,
        valueZM: s.z,
        provenance: s.prov,
        constraintTier: "primary" as const,
      }));
      if (secondarySamples.length === 0 && primarySamples.length === 3) {
        method = "exact_three_non_collinear_points";
      }
    } else if (allowSecondary && primarySamples.length + secondarySamples.length >= 3) {
      fitPoints = [...primarySamples, ...secondarySamples];
      fallbackUsed = secondarySamples.length > 0 || primarySamples.length < 3;
      usedConstraints = fitPoints.map((s) => ({
        vertexId: s.vertexId,
        heightQuantityId: s.quantityId,
        valueZM: s.z,
        provenance: s.prov,
        constraintTier: isPrimaryProv(s.prov) ? ("primary" as const) : ("secondary" as const),
      }));
      method = "least_squares_with_secondary_provenance_heights";
    } else {
      invalidPatchCount++;
      missing.push("UNDER_CONSTRAINED_NEED_3_HEIGHT_SAMPLES");
      solutions.push({
        roofPatchId: patchId,
        planeEquation: null,
        planeNormal: null,
        explicitZ: null,
        solvedVertices3D: null,
        supportConstraintsUsed: [],
        topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
        resolutionMethod: "unresolved_under_constrained",
        resolutionConfidence: "none",
        isFullyConstrained: false,
        isFallbackUsed: false,
        maxResidualM: null,
        diagnostics: { missingConstraints: missing, conflicts },
      });
      continue;
    }

    const fit = fitLeastSquaresPlane(fitPoints);
    if (!fit) {
      invalidPatchCount++;
      conflicts.push("PLANE_FIT_SINGULAR");
      solutions.push({
        roofPatchId: patchId,
        planeEquation: null,
        planeNormal: null,
        explicitZ: null,
        solvedVertices3D: null,
        supportConstraintsUsed: usedConstraints,
        topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
        resolutionMethod: "unresolved_vertical_plane",
        resolutionConfidence: "none",
        isFullyConstrained: false,
        isFallbackUsed: fallbackUsed,
        maxResidualM: null,
        diagnostics: { missingConstraints: missing, conflicts },
      });
      continue;
    }

    const { a, b, c } = fit;
    const equation = equationFromExplicitZ(a, b, c);
    if (equation.normal.z < EPS_Z_DENOM) {
      invalidPatchCount++;
      conflicts.push("PLANE_NEAR_VERTICAL_UNSUPPORTED_V1");
      solutions.push({
        roofPatchId: patchId,
        planeEquation: null,
        planeNormal: null,
        explicitZ: { a, b, c },
        solvedVertices3D: null,
        supportConstraintsUsed: usedConstraints,
        topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
        resolutionMethod: "unresolved_vertical_plane",
        resolutionConfidence: "none",
        isFullyConstrained: false,
        isFallbackUsed: fallbackUsed,
        maxResidualM: null,
        diagnostics: { missingConstraints: missing, conflicts },
      });
      continue;
    }

    let maxRes = 0;
    for (const p of fitPoints) {
      const zp = evaluateZOnRoofPlane(equation, p.x, p.y);
      maxRes = Math.max(maxRes, Math.abs(p.z - zp));
    }
    if (maxRes > tol) {
      constraintConflictCount++;
      invalidPatchCount++;
      conflicts.push(`HEIGHT_PLANE_RESIDUAL_EXCEEDED:${maxRes.toFixed(6)}>${tol}`);
      solutions.push({
        roofPatchId: patchId,
        planeEquation: equation,
        planeNormal: equation.normal,
        explicitZ: { a, b, c },
        solvedVertices3D: null,
        supportConstraintsUsed: usedConstraints,
        topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
        resolutionMethod: "unresolved_conflicting_heights",
        resolutionConfidence: "low",
        isFullyConstrained: false,
        isFallbackUsed: fallbackUsed,
        maxResidualM: maxRes,
        diagnostics: { missingConstraints: missing, conflicts },
      });
      continue;
    }

    const solvedVertices3D: BuildingLocalVec3[] = docPatch.boundaryVertexIds.map((vid) => {
      const vx = document.roof.topology.vertices.find((v) => v.vertexId === vid)!;
      const x = vx.positionXY.x;
      const y = vx.positionXY.y;
      const z = evaluateZOnRoofPlane(equation, x, y);
      return { x, y, z };
    });

    solvedPatchCount++;
    const fully =
      !fallbackUsed &&
      primarySamples.length >= 3 &&
      missing.length === 0 &&
      docPatch.boundaryVertexIds.every((vid) => resolveVertexHeight(document, vid) != null);
    if (fully) fullyConstrainedPatchCount++;
    else partialPatchCount++;
    if (fallbackUsed) fallbackPatchCount++;

    const resConfidence: RoofPatchPlaneSolution["resolutionConfidence"] =
      fully && maxRes < tol / 10 ? "high" : fallbackUsed ? "medium" : "high";

    solutions.push({
      roofPatchId: patchId,
      planeEquation: equation,
      planeNormal: equation.normal,
      explicitZ: { a, b, c },
      solvedVertices3D,
      supportConstraintsUsed: usedConstraints,
      topologyHintsUsed: collectTopologyHints(topologyGraph, patchId, gp.boundaryTopologyVertexIds),
      resolutionMethod: method,
      resolutionConfidence: resConfidence,
      isFullyConstrained: fully,
      isFallbackUsed: fallbackUsed,
      maxResidualM: maxRes,
      diagnostics: { missingConstraints: missing, conflicts },
    });
  }

  // Notification UI — plans quasi-verticaux non supportés (navigateur uniquement).
  const verticalCount = solutions.filter((s) =>
    s.diagnostics.conflicts.includes("PLANE_NEAR_VERTICAL_UNSUPPORTED_V1"),
  ).length;
  if (typeof window !== "undefined" && verticalCount > 0) {
    window.dispatchEvent(
      new CustomEvent("calpinage:unsupported-roof-plane", {
        detail: { reason: "PLANE_NEAR_VERTICAL_UNSUPPORTED_V1", count: verticalCount },
      }),
    );
  }

  const patchCount = topologyGraph.patches.length;
  const setDiagnostics: RoofPlaneSolutionSetDiagnostics = {
    isValid: invalidPatchCount === 0 && constraintConflictCount === 0,
    patchCount,
    solvedPatchCount,
    fullyConstrainedPatchCount,
    partialPatchCount,
    fallbackPatchCount,
    ambiguousPatchCount,
    invalidPatchCount,
    constraintConflictCount,
    errors: globalErrors,
    warnings: globalWarnings,
  };

  const solutionSet: RoofPlaneSolutionSet = {
    schemaId: ROOF_PLANE_SOLUTION_SET_SCHEMA_ID,
    solutions,
    diagnostics: setDiagnostics,
  };

  return { solutionSet };
}
