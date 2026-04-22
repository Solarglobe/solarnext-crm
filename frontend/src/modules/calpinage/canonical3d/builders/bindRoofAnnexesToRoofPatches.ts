/**
 * Binding officiel annexes ↔ pans : topologie graphe + emprises XY + aires d’intersection.
 * Pas de « pan le plus proche » silencieux : statuts et diagnostics explicites.
 */

import type {
  AnnexDiscriminated,
  CanonicalHouseDocument,
  CanonicalHouseEntityId,
  Polygon2DLocal,
  RoofAnnexBindingConfidence,
  RoofAnnexBindingStatus,
  RoofAnnexOfficialFamily,
  RoofAnnexTopologyCompatibility,
} from "../model/canonicalHouse3DModel";
import type { RoofTopologyGraph } from "../model/roofTopologyModel";
import type { RoofPlaneSolutionSet } from "../model/roofPlaneSolutionModel";
import {
  centroid2d,
  intersectionAreaM2,
  pointInPolygon2dXY,
  polygonAreaM2,
  segmentCrossesPolygonBoundary,
  segmentProperIntersection2d,
  type Ring2D,
  type XY,
} from "./roofAnnexPolygon2d";
import { mapAnnexFamilyToOfficial } from "./mapAnnexFamilyToOfficial";

const EPS_FRAC = 0.02;
const FRAC_FULL = 0.98;
const FRAC_MULTI = 0.05;
const FRAC_AMBIG = 0.01;
const EPS_AREA = 1e-8;

export interface RoofAnnexBindingWorkItem {
  readonly annex: AnnexDiscriminated;
  readonly annexFamily: RoofAnnexOfficialFamily;
  readonly sourceEntityKind: string;
  readonly primaryRoofPatchId: CanonicalHouseEntityId | null;
  readonly bindingStatus: RoofAnnexBindingStatus;
  readonly bindingConfidence: RoofAnnexBindingConfidence;
  readonly footprint2D: Polygon2DLocal | null;
  readonly overlapByPatchId: Readonly<Record<string, number>>;
  readonly topologyCompatibility: RoofAnnexTopologyCompatibility;
  readonly diagnostics: readonly string[];
}

export interface BindRoofAnnexesToRoofPatchesInput {
  readonly document: CanonicalHouseDocument;
  readonly topologyGraph: RoofTopologyGraph;
  readonly solutionSet: RoofPlaneSolutionSet;
}

export interface BindRoofAnnexesToRoofPatchesResult {
  readonly items: readonly RoofAnnexBindingWorkItem[];
}

function patchPolygonXY(graph: RoofTopologyGraph, roofPatchId: string): Ring2D | null {
  const node = graph.patches.find((p) => p.roofPatchId === roofPatchId);
  if (!node || node.boundaryTopologyVertexIds.length < 3) return null;
  const poly: XY[] = [];
  for (const vid of node.boundaryTopologyVertexIds) {
    const v = graph.vertices.find((x) => x.topologyVertexId === vid);
    if (!v) return null;
    poly.push(v.positionXY);
  }
  return poly;
}

function hasPlaneForPatch(solutionSet: RoofPlaneSolutionSet, patchId: string): boolean {
  const s = solutionSet.solutions.find((x) => x.roofPatchId === patchId);
  return Boolean(s?.planeEquation && s.resolutionConfidence !== "none");
}

/**
 * Croisement d’une arête structurante (faîtage / noue / arêtier) géométriquement pertinente pour le pan :
 * arête hors pur contour d’égout (sauf flottante) et dont le milieu est dans l’emprise XY du pan.
 * (Les arêtes internes type « faîtage dessiné » n’ont souvent pas d’`incidentPatchIds` dans le graphe.)
 */
function footprintCrossesStructuralRoofEdge(
  footprint: Ring2D,
  graph: RoofTopologyGraph,
  patchId: string,
): boolean {
  const patchPoly = patchPolygonXY(graph, patchId);
  if (!patchPoly) return false;
  const node = graph.patches.find((p) => p.roofPatchId === patchId);
  if (!node) return false;
  const boundaryTe = new Set(node.boundaryTopologyEdgeIds);

  for (const e of graph.edges) {
    if (e.officialKind !== "ridge" && e.officialKind !== "valley" && e.officialKind !== "hip") continue;
    if (boundaryTe.has(e.topologyEdgeId) && !e.isFloatingStructural) continue;
    const va = graph.vertices.find((v) => v.topologyVertexId === e.vertexTopologyIdA);
    const vb = graph.vertices.find((v) => v.topologyVertexId === e.vertexTopologyIdB);
    if (!va || !vb) continue;
    const b1 = va.positionXY;
    const b2 = vb.positionXY;
    const mid = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
    if (!pointInPolygon2dXY(mid.x, mid.y, patchPoly)) continue;
    const n = footprint.length;
    for (let i = 0; i < n; i++) {
      const f1 = footprint[i]!;
      const f2 = footprint[(i + 1) % n]!;
      if (segmentProperIntersection2d(f1, f2, b1, b2)) return true;
    }
  }
  return false;
}

function footprintCrossesPatchBoundaryExceptContained(
  footprint: Ring2D,
  patchPoly: Ring2D,
  allInside: boolean,
): boolean {
  if (allInside) return false;
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    const a = footprint[i]!;
    const b = footprint[(i + 1) % n]!;
    if (segmentCrossesPolygonBoundary(a, b, patchPoly)) return true;
  }
  return false;
}

function bindOneAnnex(
  annex: AnnexDiscriminated,
  graph: RoofTopologyGraph,
  solutionSet: RoofPlaneSolutionSet,
): RoofAnnexBindingWorkItem {
  const { annexFamily, sourceEntityKind } = mapAnnexFamilyToOfficial(annex.family, annex);
  const diag: string[] = [];

  if (annex.geometry.kind !== "footprint_extrusion") {
    diag.push(`geometry.kind=${annex.geometry.kind} — pas d’emprise planaire exploitable pour binding XY.`);
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: null,
      bindingStatus: "no_footprint_geometry",
      bindingConfidence: "none",
      footprint2D: null,
      overlapByPatchId: {},
      topologyCompatibility: "unsupported_geometry",
      diagnostics: diag,
    };
  }

  const footprint = annex.geometry.footprint as Ring2D;
  if (footprint.length < 3) {
    diag.push("footprint < 3 sommets.");
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: null,
      bindingStatus: "degenerate_footprint",
      bindingConfidence: "none",
      footprint2D: footprint,
      overlapByPatchId: {},
      topologyCompatibility: "unsupported_geometry",
      diagnostics: diag,
    };
  }

  const areaF = polygonAreaM2(footprint);
  if (areaF < EPS_AREA) {
    diag.push("aire footprint négligeable.");
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: null,
      bindingStatus: "degenerate_footprint",
      bindingConfidence: "none",
      footprint2D: footprint,
      overlapByPatchId: {},
      topologyCompatibility: "invalid_position",
      diagnostics: diag,
    };
  }

  const overlapByPatchId: Record<string, number> = {};
  for (const p of graph.patches) {
    if (p.status === "degenerate") continue;
    const poly = patchPolygonXY(graph, p.roofPatchId);
    if (!poly) continue;
    const a = intersectionAreaM2(poly, footprint);
    if (a > EPS_AREA) overlapByPatchId[p.roofPatchId] = a;
  }

  const entries = Object.entries(overlapByPatchId).sort((u, v) => v[1] - u[1]);
  if (entries.length === 0) {
    diag.push("Aucune intersection d’aire positive avec un pan topologique.");
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: null,
      bindingStatus: "outside_all_patches",
      bindingConfidence: "high",
      footprint2D: footprint,
      overlapByPatchId,
      topologyCompatibility: "invalid_position",
      diagnostics: diag,
    };
  }

  const significant = entries.filter(([, a]) => a / areaF >= FRAC_MULTI);
  const [first, second] = significant;
  if (
    second &&
    Math.abs(first[1] - second[1]) / areaF <= FRAC_AMBIG &&
    first[1] / areaF > 0.1 &&
    second[1] / areaF > 0.1
  ) {
    diag.push(`Chevauchement ambigu entre pans ${first[0]} et ${second[0]} (aires proches).`);
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: null,
      bindingStatus: "ambiguous_patch_choice",
      bindingConfidence: "low",
      footprint2D: footprint,
      overlapByPatchId,
      topologyCompatibility: "crosses_patch_boundary",
      diagnostics: diag,
    };
  }

  const primaryId = first[0]!;
  const primaryOverlap = first[1]!;
  const patchPoly = patchPolygonXY(graph, primaryId);
  if (!patchPoly) {
    diag.push(`Polygone introuvable pour pan ${primaryId}.`);
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: null,
      bindingStatus: "outside_all_patches",
      bindingConfidence: "none",
      footprint2D: footprint,
      overlapByPatchId,
      topologyCompatibility: "invalid_position",
      diagnostics: diag,
    };
  }

  const vertsInside = footprint.filter((pt) => pointInPolygon2dXY(pt.x, pt.y, patchPoly)).length;
  const allInside = vertsInside === footprint.length;
  const c = centroid2d(footprint);
  const centroidInside = pointInPolygon2dXY(c.x, c.y, patchPoly);

  let bindingStatus: RoofAnnexBindingStatus;
  let bindingConfidence: RoofAnnexBindingConfidence;
  let topologyCompatibility: RoofAnnexTopologyCompatibility;

  if (significant.length >= 2) {
    bindingStatus = "straddles_multiple_patches";
    bindingConfidence = "medium";
    topologyCompatibility = "needs_roof_split";
    diag.push(`Emprise significative sur ${significant.length} pans (≥ ${(FRAC_MULTI * 100).toFixed(0)} % surface chacun).`);
  } else if (primaryOverlap / areaF >= FRAC_FULL && allInside && centroidInside) {
    bindingStatus = "fully_contained_single_patch";
    bindingConfidence = "high";
    topologyCompatibility = "compatible";
  } else if (primaryOverlap / areaF >= FRAC_FULL && (!allInside || !centroidInside)) {
    bindingStatus = "partial_overlap_single_patch";
    bindingConfidence = "medium";
    topologyCompatibility = "partial_overlap";
    diag.push("Aire quasi totale sur un pan mais sommets ou centroïde hors contour — vérifier géométrie.");
  } else {
    bindingStatus = "partial_overlap_single_patch";
    bindingConfidence = primaryOverlap / areaF > 0.5 ? "medium" : "low";
    topologyCompatibility = "partial_overlap";
  }

  if (footprintCrossesPatchBoundaryExceptContained(footprint, patchPoly, allInside)) {
    if (topologyCompatibility === "compatible") topologyCompatibility = "crosses_patch_boundary";
    else if (topologyCompatibility === "partial_overlap") topologyCompatibility = "crosses_patch_boundary";
    diag.push("Un segment de l’emprise traverse le contour du pan primaire.");
  }

  if (footprintCrossesStructuralRoofEdge(footprint, graph, primaryId)) {
    topologyCompatibility =
      topologyCompatibility === "compatible" ? "crosses_roof_edge" : topologyCompatibility;
    if (topologyCompatibility === "partial_overlap") topologyCompatibility = "crosses_roof_edge";
    diag.push("Intersection avec une arête structurante flottante (faîtage / noue / arêtier) liée au pan.");
  }

  if (!hasPlaneForPatch(solutionSet, primaryId)) {
    diag.push(`Aucun plan résolu utilisable pour le pan ${primaryId} — binding géométrique 3D bloqué.`);
    return {
      annex,
      annexFamily,
      sourceEntityKind,
      primaryRoofPatchId: primaryId,
      bindingStatus: "no_solved_plane_for_primary_patch",
      bindingConfidence: "low",
      footprint2D: footprint,
      overlapByPatchId,
      topologyCompatibility,
      diagnostics: diag,
    };
  }

  if (significant.length >= 2 && bindingStatus !== "straddles_multiple_patches") {
    /* sécurité */
    bindingStatus = "straddles_multiple_patches";
  }

  const ratioSecond = second ? second[1] / areaF : 0;
  if (ratioSecond > EPS_FRAC && significant.length < 2) {
    diag.push(`Second pan ${second![0]} encore ${(ratioSecond * 100).toFixed(1)} % — considérer multi-pan.`);
  }

  return {
    annex,
    annexFamily,
    sourceEntityKind,
    primaryRoofPatchId: primaryId,
    bindingStatus,
    bindingConfidence,
    footprint2D: footprint,
    overlapByPatchId,
    topologyCompatibility,
    diagnostics: diag,
  };
}

export function bindRoofAnnexesToRoofPatches(
  input: BindRoofAnnexesToRoofPatchesInput,
): BindRoofAnnexesToRoofPatchesResult {
  const items = input.document.annexes.map((a) =>
    bindOneAnnex(a, input.topologyGraph, input.solutionSet),
  );
  return { items };
}
