/**
 * Contraintes inter-pans : analyse des arêtes communes, rapports de relation,
 * raffinement explicite des normales de pans le long d’arêtes structurantes partagées.
 *
 * Stratégie (documentée, pas magique) :
 * - Une face planaire doit avoir une normale ⟂ à chaque arête du polygone ; Newell s’en approche.
 * - Les arêtes **partagées** marquées ridge ou trait ajoutent une contrainte forte : on projette
 *   la normale Newell sur ⟂ aux directions d’arête (Gram-Schmidt), puis réorientation ciel et
 *   recalcul équation / frame / résidus.
 * - Si le résidu RMS augmente trop vs l’avant, on **ne change pas** la normale et on émet un diagnostic.
 */

import type { RoofEdge3D } from "../types/edge";
import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { Vector3 } from "../types/primitives";
import type { LegacyRoofGeometryInput } from "./legacyInput";
import type {
  InterPanContinuityGrade,
  InterPanRelationReport,
  SharedStructuralEdgeConstraint,
  SharedStructuralEdgeRole,
} from "./interPanTypes";
import {
  azimuthDegEnuHorizontalNormal,
  buildLocalFrameRoofFace,
  centroid3,
  orientExteriorNormalTowardSky,
  planeEquationFromUnitNormalAndPoint,
  planeFitResidualRms,
  polygonArea3dIntrinsic,
  polygonProjectedHorizontalAreaXY,
  projectPointToPlaneUv,
  tiltDegFromNormalAndUp,
} from "./planePolygon3d";
import { dot3, normalize3, scale3, sub3 } from "../utils/math3";

const RESIDUAL_HIGH = 0.05;
const RESIDUAL_OK = 0.005;
const REFINEMENT_RESIDUAL_REGRET = 0.012;

function structuralRoleFromEdge(e: RoofEdge3D): SharedStructuralEdgeRole {
  const k = e.semantic?.kind;
  if (k === "ridge") return "ridge_line";
  if (k === "internal_split") return "break_line";
  return "topology_only";
}

function angleBetweenNormalsDeg(n1: Vector3, n2: Vector3): number {
  const d = dot3(n1, n2);
  const c = Math.max(-1, Math.min(1, d));
  return (Math.acos(c) * 180) / Math.PI;
}

function gradeFromMetrics(
  role: SharedStructuralEdgeRole,
  angleBetweenNormalsDeg: number,
  dihedralProfileDeg: number
): InterPanContinuityGrade {
  if (role === "topology_only") {
    if (angleBetweenNormalsDeg < 3) return "weak";
    if (angleBetweenNormalsDeg < 12) return "medium";
    return "ambiguous";
  }
  if (role === "ridge_line") {
    if (dihedralProfileDeg < 2 || dihedralProfileDeg > 178) return "ambiguous";
    if (dihedralProfileDeg >= 8 && dihedralProfileDeg <= 172) return "strong";
    return "medium";
  }
  /* break_line */
  if (dihedralProfileDeg < 3) return "ambiguous";
  if (dihedralProfileDeg >= 10) return "strong";
  return "medium";
}

/**
 * Projette une normale unitaire pour être ⟂ à une liste de directions unitaires (arêtes).
 */
export function projectNormalOrthogonalToEdgeDirections(
  nUnit: Vector3,
  unitDirections: readonly Vector3[]
): Vector3 | null {
  let n = { ...nUnit };
  for (const d of unitDirections) {
    const du = normalize3(d);
    if (!du) continue;
    const t = dot3(n, du);
    n = sub3(n, scale3(du, t));
    const nn = normalize3(n);
    if (!nn) return null;
    n = nn;
  }
  return normalize3(n);
}

/**
 * Collecte les contraintes structurantes par pan (arête commune + direction monde).
 */
export function collectStructuralSharedEdgeConstraintsByPan(
  edges: readonly RoofEdge3D[]
): ReadonlyMap<string, SharedStructuralEdgeConstraint[]> {
  const byPan = new Map<string, SharedStructuralEdgeConstraint[]>();
  function add(pid: string, c: SharedStructuralEdgeConstraint) {
    const arr = byPan.get(pid) ?? [];
    arr.push(c);
    byPan.set(pid, arr);
  }
  for (const e of edges) {
    const pans = e.incidentPlanePatchIds;
    if (pans.length !== 2) continue;
    const role = structuralRoleFromEdge(e);
    if (role === "topology_only") continue;
    const [p0, p1] = [...pans].sort();
    const dir = e.directionWorld;
    add(p0, { edgeId: e.id, otherPlanePatchId: p1, unitEdgeDirectionWorld: { ...dir }, role });
    add(p1, { edgeId: e.id, otherPlanePatchId: p0, unitEdgeDirectionWorld: { x: -dir.x, y: -dir.y, z: -dir.z }, role });
  }
  return byPan;
}

export interface PanWorkLike {
  planePatch: RoofPlanePatch3D;
  cornersWorld: readonly Vector3[];
  boundaryVertexIds: readonly string[];
  tiltDegHint?: number;
  azimuthDegHint?: number;
}

/**
 * Recalcule équation, frame, UV, aires, qualité pour un patch après changement de normale.
 */
function rebuildPlanePatchGeometry(
  patch: RoofPlanePatch3D,
  cornersWorld: readonly Vector3[],
  exterior: Vector3,
  upWorld: Vector3,
  panId: string,
  tiltDegHint: number | undefined,
  azimuthDegHint: number | undefined,
  extraDiagnostics: GeometryDiagnostic[]
): RoofPlanePatch3D {
  const c = centroid3(cornersWorld);
  const residual = planeFitResidualRms(cornersWorld, exterior, c);
  const equation = planeEquationFromUnitNormalAndPoint(exterior, c);
  const firstEdge = sub3(cornersWorld[1], cornersWorld[0]);
  const localFrame = buildLocalFrameRoofFace(c, exterior, firstEdge);
  const uvPoly = cornersWorld.map((p) =>
    projectPointToPlaneUv(p, localFrame.origin, localFrame.xAxis, localFrame.yAxis)
  );
  const areaIntrinsic = polygonArea3dIntrinsic(cornersWorld);
  const areaProj = polygonProjectedHorizontalAreaXY(cornersWorld);
  let confidence: RoofPlanePatch3D["quality"]["confidence"] = patch.quality.confidence;
  const panDiagnostics: GeometryDiagnostic[] = [...patch.quality.diagnostics];
  if (residual > RESIDUAL_HIGH) {
    confidence = "low";
    panDiagnostics.push({
      code: "PLANE_HIGH_RESIDUAL",
      severity: "warning",
      message: `Coplanarité faible après raffinement inter-pans (RMS=${residual.toFixed(4)} m)`,
      context: { panId, residual },
    });
  } else if (residual > RESIDUAL_OK) {
    confidence = confidence === "high" ? "medium" : confidence;
    panDiagnostics.push({
      code: "PLANE_MODERATE_RESIDUAL",
      severity: "info",
      message: `RMS plan après raffinement ${residual.toFixed(4)} m`,
      context: { panId, residual },
    });
  }
  panDiagnostics.push(...extraDiagnostics);
  const tiltDeg = tiltDegFromNormalAndUp(exterior, upWorld);
  const azimuthDeg =
    typeof azimuthDegHint === "number" && Number.isFinite(azimuthDegHint)
      ? azimuthDegHint
      : azimuthDegEnuHorizontalNormal(exterior);
  return {
    ...patch,
    centroid: c,
    normal: exterior,
    equation,
    localFrame,
    polygon2DInPlane: uvPoly,
    tiltDeg: typeof tiltDegHint === "number" && Number.isFinite(tiltDegHint) ? tiltDegHint : tiltDeg,
    azimuthDeg,
    surface: {
      areaM2: Math.max(0, areaIntrinsic),
      projectedHorizontalAreaM2: Math.max(0, areaProj),
    },
    quality: { confidence, diagnostics: panDiagnostics },
  };
}

/**
 * Applique le raffinement des normales sur chaque pan à partir des arêtes structurantes partagées.
 * Mutates `panWorks[].planePatch` en place.
 */
export function applyStructuralSharedEdgePlaneRefinement(
  panWorks: PanWorkLike[],
  edges: readonly RoofEdge3D[],
  upWorld: Vector3,
  globalDiagnostics: GeometryDiagnostic[]
): void {
  const byPan = collectStructuralSharedEdgeConstraintsByPan(edges);

  for (const w of panWorks) {
    const constraints = byPan.get(w.planePatch.id);
    if (!constraints?.length) continue;

    const dirs = constraints.map((c) => c.unitEdgeDirectionWorld);
    const n0 = w.planePatch.normal;
    const residualBefore = planeFitResidualRms(w.cornersWorld, n0, centroid3(w.cornersWorld));

    const nCandidate = projectNormalOrthogonalToEdgeDirections(n0, dirs);
    if (!nCandidate) {
      globalDiagnostics.push({
        code: "PLANE_REFINEMENT_DEGENERATE_PROJECTION",
        severity: "warning",
        message: `Raffinement inter-pans : projection de normale dégénérée pour pan ${w.planePatch.id}`,
        context: { panId: w.planePatch.id },
      });
      continue;
    }
    const exterior = orientExteriorNormalTowardSky(nCandidate, upWorld);

    const residualAfter = planeFitResidualRms(w.cornersWorld, exterior, centroid3(w.cornersWorld));
    if (residualAfter > residualBefore + REFINEMENT_RESIDUAL_REGRET && residualAfter > RESIDUAL_HIGH) {
      globalDiagnostics.push({
        code: "PLANE_REFINEMENT_REVERTED_RESIDUAL",
        severity: "warning",
        message: `Raffinement inter-pans annulé pour pan ${w.planePatch.id} (RMS augmenté trop)`,
        context: { panId: w.planePatch.id, before: residualBefore, after: residualAfter },
      });
      continue;
    }

    const extraDiag: GeometryDiagnostic[] = [
      {
        code: "PLANE_REFINED_STRUCTURAL_SHARED_EDGES",
        severity: "info",
        message: `Normale ajustée pour orthogonalité aux arêtes structurantes partagées (${constraints.length})`,
        context: { panId: w.planePatch.id, edgeCount: constraints.length },
      },
    ];

    w.planePatch = rebuildPlanePatchGeometry(
      w.planePatch,
      w.cornersWorld,
      exterior,
      upWorld,
      w.planePatch.id,
      w.tiltDegHint,
      w.azimuthDegHint,
      extraDiag
    );
  }
}

/**
 * Construit les rapports inter-pans pour chaque arête commune entre exactement deux pans.
 */
export function buildInterPanRelationReports(
  panById: ReadonlyMap<string, RoofPlanePatch3D>,
  edges: readonly RoofEdge3D[],
  input: LegacyRoofGeometryInput
): InterPanRelationReport[] {
  const reports: InterPanRelationReport[] = [];
  for (const e of edges) {
    const pans = e.incidentPlanePatchIds;
    if (pans.length > 2) {
      reports.push({
        edgeId: e.id,
        planePatchIdA: pans[0],
        planePatchIdB: pans[1],
        structuralRole: "topology_only",
        angleBetweenNormalsDeg: 0,
        dihedralProfileDeg: 0,
        continuityGrade: "ambiguous",
        diagnostics: [
          {
            code: "INTERPAN_NON_MANIFOLD_EDGE",
            severity: "warning",
            message: `Arête ${e.id} incidente à ${pans.length} pans — relation inter-pans ambiguë`,
            context: { edgeId: e.id, panCount: pans.length },
          },
        ],
      });
      continue;
    }
    if (pans.length !== 2) continue;

    const [idA, idB] = [...pans].sort();
    const pa = panById.get(idA);
    const pb = panById.get(idB);
    if (!pa || !pb) continue;

    const n1 = pa.normal;
    const n2 = pb.normal;
    const angleDeg = angleBetweenNormalsDeg(n1, n2);
    const dihedralProfileDeg = Math.abs(180 - angleDeg);
    const role = structuralRoleFromEdge(e);
    const grade = gradeFromMetrics(role, angleDeg, dihedralProfileDeg);

    const diag: GeometryDiagnostic[] = [];
    const hz = heightDeltaFromStructuralInput(e, input);
    if (hz != null && hz > 1e-4) {
      diag.push({
        code: "INTERPAN_HEIGHT_ASYMMETRY_ALONG_STRUCTURAL_LINE",
        severity: "info",
        message: `Écart de hauteur sur la ligne structurante au bord commun : ${hz.toFixed(4)} m`,
        context: { edgeId: e.id, deltaM: hz },
      });
    }
    if (role === "break_line" && dihedralProfileDeg < 4) {
      diag.push({
        code: "INTERPAN_BREAK_LINE_NEARLY_COPLANAR",
        severity: "warning",
        message: "Trait / cassure marquée mais pans presque coplanaires en normales — géométrie ambiguë",
        context: { edgeId: e.id, dihedralProfileDeg },
      });
    }
    if (role === "ridge_line" && (angleDeg < 4 || angleDeg > 176)) {
      diag.push({
        code: "INTERPAN_RIDGE_ALMOST_COPLANAR_OR_FLAT",
        severity: "warning",
        message: "Faîtage déclaré mais angle entre normales quasi 0° ou 180° — vérifier la géométrie",
        context: { edgeId: e.id, angleBetweenNormalsDeg: angleDeg },
      });
    }
    if (role === "topology_only") {
      diag.push({
        code: "INTERPAN_SHARED_EDGE_TOPOLOGY_ONLY",
        severity: "info",
        message: "Arête commune sans ligne structurante reconnue — continuité géométrique non pilotée par ridge/trait",
        context: { edgeId: e.id },
      });
    } else {
      diag.push({
        code: "INTERPAN_SHARED_EDGE_STRUCTURALLY_TAGGED",
        severity: "info",
        message:
          role === "ridge_line"
            ? "Arête commune alignée sur un faîtage structurant — contrainte de normale renforcée"
            : "Arête commune alignée sur un trait / cassure — séparation de plans prise en compte",
        context: { edgeId: e.id, structuralRole: role === "ridge_line" ? "ridge_line" : "break_line" },
      });
    }

    reports.push({
      edgeId: e.id,
      planePatchIdA: idA,
      planePatchIdB: idB,
      structuralRole: role,
      angleBetweenNormalsDeg: angleDeg,
      dihedralProfileDeg,
      continuityGrade: grade,
      structuralHeightDeltaM: hz,
      diagnostics: diag,
    });
  }
  return reports;
}

function heightDeltaFromStructuralInput(edge: RoofEdge3D, input: LegacyRoofGeometryInput): number | undefined {
  if (!edge.ridgeLineId?.startsWith("ridge3d-")) return undefined;
  const legacyId = edge.ridgeLineId.slice("ridge3d-".length);
  const lines = [...(input.ridges ?? []), ...(input.traits ?? [])];
  const ln = lines.find((l) => l.id === legacyId);
  if (!ln) return undefined;
  const ha = typeof ln.a.heightM === "number" && Number.isFinite(ln.a.heightM) ? ln.a.heightM : undefined;
  const hb = typeof ln.b.heightM === "number" && Number.isFinite(ln.b.heightM) ? ln.b.heightM : undefined;
  if (ha == null || hb == null) return undefined;
  return Math.abs(ha - hb);
}
