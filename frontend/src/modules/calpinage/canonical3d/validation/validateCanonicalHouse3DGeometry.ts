/**
 * Validation géométrique / topologique officielle Maison 3D.
 * Entrées : uniquement sorties canoniques (document + shell + graphe + plans + intersections + binding).
 * Interdit : CALPINAGE_STATE, window, correction silencieuse.
 */

import type { CanonicalHouseDocument } from "../model/canonicalHouse3DModel";
import type { BuildBuildingShell3DResult } from "../model/buildingShell3DModel";
import type { RoofTopologyGraph } from "../model/roofTopologyModel";
import type { RoofPlaneSolutionSet } from "../model/roofPlaneSolutionModel";
import type { RoofIntersectionSet } from "../model/roofIntersectionModel";
import type { RoofBuildingBindingResult } from "../model/roofBuildingBindingModel";
import { CANONICAL_HOUSE_3D_VALIDATION_REPORT_SCHEMA_ID } from "./canonicalHouse3DValidationCodes";
import type {
  CanonicalHouse3DQualityLevel,
  CanonicalHouse3DValidationBlockReport,
  CanonicalHouse3DValidationDiagnostic,
  CanonicalHouse3DValidationReport,
  ValidateCanonicalHouse3DGeometryOptions,
} from "./canonicalHouse3DValidationModel";
import type { CanonicalHouse3DValidationCode } from "./canonicalHouse3DValidationCodes";
import { evaluateZOnRoofPlane } from "../builders/solveRoofPlanes";

const DEFAULT_RESIDUAL_M = 0.05;
const EPS_LEN = 1e-5;
const EPS_NORMAL_Z = 1e-5;

export interface ValidateCanonicalHouse3DGeometryInput {
  readonly document: CanonicalHouseDocument;
  readonly shellResult: BuildBuildingShell3DResult;
  readonly topologyGraph: RoofTopologyGraph;
  readonly solutionSet: RoofPlaneSolutionSet;
  readonly intersectionSet: RoofIntersectionSet;
  readonly bindingResult: RoofBuildingBindingResult;
  readonly options?: ValidateCanonicalHouse3DGeometryOptions;
}

function diag(
  code: CanonicalHouse3DValidationCode,
  severity: CanonicalHouse3DValidationDiagnostic["severity"],
  message: string,
  entityIds?: readonly string[],
  details?: Readonly<Record<string, string | number | boolean>>,
): CanonicalHouse3DValidationDiagnostic {
  return { code, severity, message, entityIds, details };
}

function finalizeBlock(diags: readonly CanonicalHouse3DValidationDiagnostic[]): CanonicalHouse3DValidationBlockReport {
  const errorCount = diags.filter((d) => d.severity === "error").length;
  const warningCount = diags.filter((d) => d.severity === "warning").length;
  const infoCount = diags.filter((d) => d.severity === "info").length;
  const status: CanonicalHouse3DValidationBlockReport["status"] =
    errorCount > 0 ? "error" : warningCount > 0 ? "warning" : diags.some((d) => d.severity === "info") ? "ok" : "ok";
  return { status, errorCount, warningCount, infoCount, diagnostics: diags };
}

function validateBuilding(input: ValidateCanonicalHouse3DGeometryInput): CanonicalHouse3DValidationDiagnostic[] {
  const { shellResult, document } = input;
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const fp = document.building.buildingFootprint;
  if (!Array.isArray(fp) || fp.length < 3) {
    d.push(
      diag("BUILDING_FOOTPRINT_INVALID", "error", "buildingFootprint absent ou < 3 sommets exploitables.", [
        document.building.buildingId,
      ]),
    );
  }
  if (!shellResult.shell) {
    d.push(diag("BUILDING_SHELL_MISSING", "error", "Coque bâtiment non construite (shell null)."));
    for (const msg of shellResult.diagnostics.errors) {
      d.push(diag("BUILDING_SHELL_DIAGNOSTIC_FAILED", "error", msg));
    }
    return d;
  }
  const bd = shellResult.diagnostics;
  if (!bd.isValid) {
    for (const msg of bd.errors) {
      d.push(diag("BUILDING_SHELL_DIAGNOSTIC_FAILED", "error", msg));
    }
  }
  if (!bd.isClosedLateralShell) {
    d.push(diag("BUILDING_SHELL_OPEN", "error", "Coque latérale non fermée (trou ou arêtes manquantes)."));
  }
  if (!bd.normalsConsistent) {
    d.push(diag("BUILDING_NORMAL_INVERTED", "warning", "Normales mur non toutes cohérentes avec la géométrie attendue."));
  }
  if (bd.windingDetected === "degenerate") {
    d.push(diag("BUILDING_FOOTPRINT_INVALID", "error", "Footprint dégénéré (aire nulle après normalisation)."));
  }
  if (bd.degenerateSegmentCount > 0) {
    d.push(
      diag(
        "BUILDING_WALL_DEGENERATE",
        "warning",
        `${bd.degenerateSegmentCount} segment(s) de contour écarté(s) comme dégénéré(s).`,
        undefined,
        { degenerateSegmentCount: bd.degenerateSegmentCount },
      ),
    );
  }
  const shell = shellResult.shell;
  for (const w of shell.wallFaces) {
    if (w.lengthM < EPS_LEN) {
      d.push(
        diag(
          "BUILDING_WALL_ZERO_LENGTH",
          "error",
          `Mur ${w.wallId} : longueur horizontale quasi nulle.`,
          [w.wallId],
          { lengthM: w.lengthM },
        ),
      );
    }
    if (!Number.isFinite(w.heightM) || w.heightM <= 0) {
      d.push(
        diag(
          "BUILDING_HEIGHT_INCONSISTENT",
          "error",
          `Mur ${w.wallId} : hauteur incohérente.`,
          [w.wallId],
          { heightM: w.heightM },
        ),
      );
    }
    const n = w.outwardNormal;
    const len = Math.hypot(n.x, n.y, n.z);
    if (Math.abs(len - 1) > 0.02) {
      d.push(
        diag(
          "BUILDING_NORMAL_INVERTED",
          "warning",
          `Mur ${w.wallId} : normale sortante non unitaire.`,
          [w.wallId],
        ),
      );
    }
  }
  const zh = shell.topZ - shell.baseZ;
  if (!Number.isFinite(zh) || zh <= 0) {
    d.push(diag("BUILDING_HEIGHT_INCONSISTENT", "error", "Hauteur bâtiment (topZ - baseZ) invalide."));
  }
  for (const w of bd.warnings) {
    d.push(diag("BUILDING_SHELL_DIAGNOSTIC_FAILED", "warning", w));
  }
  return d;
}

function validateRoofTopology(graph: RoofTopologyGraph): CanonicalHouse3DValidationDiagnostic[] {
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const td = graph.diagnostics;
  if (!td.isValid) {
    d.push(diag("ROOF_TOPOLOGY_INVALID", "error", "Graphe topologique toiture marqué invalide."));
    for (const msg of td.errors) {
      d.push(diag("ROOF_TOPOLOGY_INVALID", "error", msg));
    }
  }
  if (td.topologyBuildabilityLevel === "ambiguous") {
    d.push(diag("ROOF_TOPOLOGY_AMBIGUOUS", "warning", "Niveau de constructibilité topologique : ambiguous."));
  }
  if (td.degeneratePatchCount > 0) {
    d.push(
      diag(
        "ROOF_PATCH_DEGENERATE",
        "error",
        `${td.degeneratePatchCount} pan(s) dégénéré(s).`,
        undefined,
        { degeneratePatchCount: td.degeneratePatchCount },
      ),
    );
  }
  if (td.isolatedPatchCount > 0) {
    d.push(
      diag("ROOF_TOPOLOGY_AMBIGUOUS", "warning", `${td.isolatedPatchCount} pan(s) isolé(s).`, undefined, {
        isolatedPatchCount: td.isolatedPatchCount,
      }),
    );
  }
  for (const p of graph.patches) {
    if (p.status === "degenerate") {
      d.push(diag("ROOF_PATCH_DEGENERATE", "error", `Pan ${p.roofPatchId} : statut dégénéré.`, [p.roofPatchId]));
    }
    if (p.status === "boundary_open") {
      d.push(
        diag("ROOF_PATCH_BOUNDARY_OPEN", "warning", `Pan ${p.roofPatchId} : contour topologique ouvert.`, [
          p.roofPatchId,
        ]),
      );
    }
  }
  for (const e of graph.edges) {
    if (e.isFloatingStructural && e.incidentPatchIds.length === 0) {
      d.push(
        diag(
          "ROOF_EDGE_FLOATING",
          "info",
          `Arête structurante flottante ${e.topologyEdgeId} (sans incidence pan listée).`,
          [e.topologyEdgeId],
        ),
      );
    }
    if (e.kindMergeAmbiguous) {
      d.push(
        diag(
          "ROOF_SHARED_EDGE_INCONSISTENT",
          "warning",
          `Fusion de types d’arête ambiguë sur ${e.topologyEdgeId}.`,
          [e.topologyEdgeId],
        ),
      );
    }
  }
  for (const w of td.warnings) {
    d.push(diag("ROOF_TOPOLOGY_AMBIGUOUS", "warning", w));
  }
  return d;
}

function validateRoofPlanes(
  solutionSet: RoofPlaneSolutionSet,
  options?: ValidateCanonicalHouse3DGeometryOptions,
): CanonicalHouse3DValidationDiagnostic[] {
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const sd = solutionSet.diagnostics;
  const maxRes = options?.maxPlaneResidualM ?? DEFAULT_RESIDUAL_M;
  if (!sd.isValid) {
    d.push(diag("ROOF_PLANE_SOLUTION_SET_INVALID", "error", "Jeu de solutions de plans marqué invalide."));
    for (const msg of sd.errors) {
      d.push(diag("ROOF_PLANE_SOLUTION_SET_INVALID", "error", msg));
    }
  }
  for (const s of solutionSet.solutions) {
    const pid = s.roofPatchId;
    if (!s.planeEquation || !s.planeNormal) {
      if (s.resolutionMethod.startsWith("unresolved")) {
        if (s.resolutionMethod === "unresolved_under_constrained") {
          d.push(
            diag("ROOF_PLANE_UNDERCONSTRAINED", "warning", `Pan ${pid} : plan sous-contraint.`, [pid], {
              method: s.resolutionMethod,
            }),
          );
        } else if (s.resolutionMethod === "unresolved_conflicting_heights") {
          d.push(diag("ROOF_PLANE_CONFLICTING", "error", `Pan ${pid} : contraintes de hauteur contradictoires.`, [pid]));
        } else if (s.resolutionMethod === "unresolved_vertical_plane") {
          d.push(
            diag(
              "ROOF_PLANE_QUASI_VERTICAL_UNSUPPORTED",
              "error",
              `Pan ${pid} : plan quasi vertical / non supporté.`,
              [pid],
            ),
          );
        } else {
          d.push(
            diag("ROOF_PLANE_MISSING", "warning", `Pan ${pid} : plan non résolu (${s.resolutionMethod}).`, [pid], {
              method: s.resolutionMethod,
            }),
          );
        }
      } else {
        d.push(diag("ROOF_PLANE_MISSING", "error", `Pan ${pid} : équation de plan absente.`, [pid]));
      }
      continue;
    }
    if (Math.abs(s.planeNormal.z) < EPS_NORMAL_Z) {
      d.push(diag("ROOF_PLANE_QUASI_VERTICAL_UNSUPPORTED", "error", `Pan ${pid} : normale avec nz trop faible.`, [pid]));
    }
    if (s.maxResidualM !== null && s.maxResidualM > maxRes) {
      d.push(
        diag(
          "ROOF_PLANE_RESIDUAL_TOO_HIGH",
          "error",
          `Pan ${pid} : résidu max ${s.maxResidualM.toFixed(4)} m > tolérance ${maxRes}.`,
          [pid],
          { maxResidualM: s.maxResidualM, toleranceM: maxRes },
        ),
      );
    }
    if (s.isFallbackUsed) {
      const sev = options?.strictPlaneProvenance ? "warning" : "info";
      d.push(
        diag(
          "ROOF_PLANE_FALLBACK_USED",
          sev,
          `Pan ${pid} : solution avec hauteur secondaire / fallback explicite.`,
          [pid],
        ),
      );
    }
    if (s.solvedVertices3D && s.planeEquation) {
      for (const p of s.solvedVertices3D) {
        const ze = evaluateZOnRoofPlane(s.planeEquation, p.x, p.y);
        if (Number.isFinite(ze) && Math.abs(ze - p.z) > maxRes) {
          d.push(
            diag(
              "ROOF_PLANE_RESIDUAL_TOO_HIGH",
              "warning",
              `Pan ${pid} : sommet (${p.x.toFixed(3)},${p.y.toFixed(3)}) éloigné du plan résolu.`,
              [pid],
            ),
          );
          break;
        }
      }
    }
  }
  for (const w of sd.warnings) {
    d.push(diag("ROOF_PLANE_SOLUTION_SET_INVALID", "warning", w));
  }
  return d;
}

function validateIntersections(intersectionSet: RoofIntersectionSet): CanonicalHouse3DValidationDiagnostic[] {
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const id = intersectionSet.diagnostics;
  if (!id.isValid) {
    d.push(diag("ROOF_INTERSECTION_SET_INVALID", "error", "Jeu d’intersections marqué invalide."));
    for (const msg of id.errors) {
      d.push(diag("ROOF_INTERSECTION_SET_INVALID", "error", msg));
    }
  }
  if (id.sewingLevel === "partial") {
    d.push(diag("ROOF_INTERSECTION_SEWING_PARTIAL", "warning", "Niveau de couture : partial."));
  }
  if (id.sewingLevel === "ambiguous") {
    d.push(diag("ROOF_INTERSECTION_SEWING_AMBIGUOUS", "warning", "Niveau de couture : ambiguous."));
  }
  if (id.sewingLevel === "invalid") {
    d.push(diag("ROOF_INTERSECTION_SET_INVALID", "error", "Niveau de couture : invalid."));
  }
  for (const it of intersectionSet.intersections) {
    const eid = it.topologyEdgeId;
    if (!it.isConsistent) {
      d.push(diag("ROOF_INTERSECTION_INCONSISTENT", "error", `Couture incohérente sur arête ${eid}.`, [eid]));
    }
    if (it.hasGap) {
      d.push(
        diag(
          "ROOF_INTERSECTION_GAP_TOO_HIGH",
          "warning",
          `Écart XY sur couture ${eid} (gapDistanceM=${it.gapDistanceM.toFixed(4)} m).`,
          [eid],
          { gapDistanceM: it.gapDistanceM },
        ),
      );
    }
    if (it.hasStep) {
      d.push(
        diag(
          "ROOF_INTERSECTION_STEP_TOO_HIGH",
          "warning",
          `Marche Z sur couture ${eid} (stepDistanceM=${it.stepDistanceM.toFixed(4)} m).`,
          [eid],
          { stepDistanceM: it.stepDistanceM },
        ),
      );
    }
    if (!it.sharedSegment3D && it.resolutionMethod === "two_plane_line_clip_topology_edge_xy") {
      d.push(diag("ROOF_INTERSECTION_MISSING", "warning", `Segment de couture absent pour ${eid}.`, [eid]));
    }
  }
  if (id.gapCount > 0) {
    d.push(
      diag(
        "ROOF_INTERSECTION_GAP_TOO_HIGH",
        "warning",
        `Résumé moteur intersections : ${id.gapCount} couture(s) avec gap.`,
        undefined,
        { gapCount: id.gapCount },
      ),
    );
  }
  if (id.stepCount > 0) {
    d.push(
      diag(
        "ROOF_INTERSECTION_STEP_TOO_HIGH",
        "warning",
        `Résumé moteur intersections : ${id.stepCount} couture(s) avec marche Z.`,
        undefined,
        { stepCount: id.stepCount },
      ),
    );
  }
  for (const w of id.warnings) {
    d.push(diag("ROOF_INTERSECTION_INCONSISTENT", "warning", w));
  }
  return d;
}

function validateBinding(binding: RoofBuildingBindingResult): CanonicalHouse3DValidationDiagnostic[] {
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const bd = binding.diagnostics;
  if (!bd.isValid) {
    d.push(diag("ROOF_BINDING_INVALID", "error", "Liaison toit ↔ bâtiment marquée invalide."));
    for (const msg of bd.errors) {
      d.push(diag("ROOF_BINDING_INVALID", "error", msg));
    }
  }
  if (!bd.roofAttachedToBuilding) {
    d.push(
      diag(
        "ROOF_NOT_ATTACHED_TO_BUILDING",
        "error",
        "Toiture non considérée comme attachée au bâtiment (eaves / preuve structurelle).",
      ),
    );
  }
  if (bd.floatingEdgeCount > 0) {
    d.push(
      diag(
        "ROOF_EAVE_FLOATING",
        "error",
        `${bd.floatingEdgeCount} arête(s) flottante(s) (rive / eave non supportée).`,
        undefined,
        { floatingEdgeCount: bd.floatingEdgeCount },
      ),
    );
  }
  if (bd.misalignedEdgeCount > 0) {
    d.push(
      diag(
        "ROOF_EAVE_MISALIGNED",
        "error",
        `${bd.misalignedEdgeCount} arête(s) en décalage vertical par rapport au haut de mur.`,
        undefined,
        { misalignedEdgeCount: bd.misalignedEdgeCount },
      ),
    );
  }
  for (const eb of binding.eaveBindings) {
    if (!eb.isConsistent && eb.attachedWallSegmentId === null) {
      d.push(
        diag(
          "ROOF_EAVE_UNSUPPORTED",
          "error",
          `Eave ${eb.topologyEdgeId} sans mur porteur cohérent.`,
          [eb.topologyEdgeId],
        ),
      );
    }
  }
  for (const gb of binding.gableBindings) {
    if (!gb.isWallClosureGeometricallyConsistent) {
      d.push(
        diag(
          "ROOF_GABLE_INCONSISTENT",
          "warning",
          `Pignon ${gb.topologyEdgeId} : fermeture murale géométriquement incohérente.`,
          [gb.topologyEdgeId],
        ),
      );
    }
  }
  for (const fr of binding.freeRidgeBindings) {
    if (fr.supportStatus === "floating") {
      d.push(
        diag(
          "ROOF_RIDGE_FREE_UNSUPPORTED",
          "warning",
          `Rive libre ${fr.topologyEdgeId} : support flottant.`,
          [fr.topologyEdgeId],
        ),
      );
    }
  }
  for (const oh of binding.overhangs) {
    if (oh.isIntentional === "ambiguous" || oh.isIntentional === "inconsistent_geometry") {
      d.push(
        diag(
          "ROOF_OVERHANG_AMBIGUOUS",
          "info",
          `Débord sur ${oh.topologyEdgeId} : intention ambiguë ou géométrie incohérente.`,
          [oh.topologyEdgeId],
        ),
      );
    }
  }
  if (bd.intersectionCrossCheckSummary.inconsistentSharedEdgeCount > 0) {
    d.push(
      diag(
        "ROOF_INTERSECTION_INCONSISTENT",
        "warning",
        `${bd.intersectionCrossCheckSummary.inconsistentSharedEdgeCount} couture(s) en contradiction avec le binding.`,
      ),
    );
  }
  for (const w of bd.warnings) {
    d.push(diag("ROOF_BINDING_INVALID", "warning", w));
  }
  return d;
}

function validateAnnexes(document: CanonicalHouseDocument): CanonicalHouse3DValidationDiagnostic[] {
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const block = document.roofAnnexes;
  if (!block) {
    d.push(
      diag(
        "ANNEX_LAYER_MISSING_OPTIONAL",
        "info",
        "Couche roofAnnexes absente — validation annexes ignorée (optionnel).",
      ),
    );
    return d;
  }
  for (const it of block.items) {
    if (it.bindingStatus === "ambiguous_patch_choice" || it.bindingStatus === "straddles_multiple_patches") {
      d.push(
        diag(
          it.bindingStatus === "ambiguous_patch_choice" ? "ANNEX_BINDING_AMBIGUOUS" : "ANNEX_NEEDS_TOPOLOGY_SPLIT",
          "warning",
          `Annexe ${it.annexId} : ${it.bindingStatus}.`,
          [it.annexId],
        ),
      );
    }
    if (
      it.bindingStatus === "outside_all_patches" ||
      it.bindingStatus === "no_solved_plane_for_primary_patch" ||
      !it.roofPatchId
    ) {
      if (it.bindingStatus === "outside_all_patches" || !it.roofPatchId) {
        d.push(
          diag("ANNEX_NO_HOST_PATCH", "warning", `Annexe ${it.annexId} : pas de pan hôte fiable.`, [it.annexId]),
        );
      }
    }
    if (it.geometryStatus === "height_missing" && it.annexFamily === "roof_obstacle_solid") {
      d.push(diag("ANNEX_HEIGHT_MISSING", "warning", `Obstacle ${it.annexId} sans hauteur exploitable.`, [it.annexId]));
    }
    if (it.geometryStatus === "volume_ok" && it.footprint3D && it.sideFacesTriangleIndices === null) {
      if (it.annexFamily === "roof_obstacle_solid" || it.annexFamily === "roof_shadow_volume") {
        /* peut être footprint seul si hauteur 0 — déjà couvert par height_missing */
      }
    }
    if (it.geometryStatus === "edge_uplift_deferred") {
      d.push(
        diag("ANNEX_EDGE_UPLIFT_DEFERRED", "info", `Annexe ${it.annexId} : acrotère / relevé non maillé (v1).`, [
          it.annexId,
        ]),
      );
    }
    if (it.extensionTopologyIntent === "needs_dedicated_topology_split") {
      d.push(
        diag(
          "ANNEX_NEEDS_TOPOLOGY_SPLIT",
          "info",
          `Extension ${it.annexId} : découpe topologique dédiée requise (non effectuée).`,
          [it.annexId],
        ),
      );
    }
    if (it.geometryStatus === "plane_unresolved" && it.annexFamily !== "roof_edge_uplift") {
      d.push(
        diag("ANNEX_VOLUME_INVALID", "warning", `Annexe ${it.annexId} : géométrie 3D non résolue sur plan.`, [
          it.annexId,
        ]),
      );
    }
  }
  for (const w of block.diagnostics.warnings) {
    d.push(diag("ANNEX_VOLUME_INVALID", "warning", w));
  }
  for (const e of block.diagnostics.errors) {
    d.push(diag("ANNEX_VOLUME_INVALID", "error", e));
  }
  return d;
}

function validateGlobal(
  input: ValidateCanonicalHouse3DGeometryInput,
  blocks: {
    building: CanonicalHouse3DValidationDiagnostic[];
    topology: CanonicalHouse3DValidationDiagnostic[];
    planes: CanonicalHouse3DValidationDiagnostic[];
    intersections: CanonicalHouse3DValidationDiagnostic[];
    binding: CanonicalHouse3DValidationDiagnostic[];
    annexes: CanonicalHouse3DValidationDiagnostic[];
  },
): CanonicalHouse3DValidationDiagnostic[] {
  const d: CanonicalHouse3DValidationDiagnostic[] = [];
  const all = [
    ...blocks.building,
    ...blocks.topology,
    ...blocks.planes,
    ...blocks.intersections,
    ...blocks.binding,
    ...blocks.annexes,
  ];
  const err = all.filter((x) => x.severity === "error").length;
  if (err > 0) {
    d.push(
      diag(
        "HOUSE_GEOMETRY_INVALID",
        "error",
        `${err} diagnostic(s) bloquant(s) sur l’ensemble maison / toiture / annexes.`,
        undefined,
        { errorCount: err },
      ),
    );
  }
  const partialPlane =
    input.solutionSet.diagnostics.partialPatchCount > 0 ||
    input.solutionSet.diagnostics.fallbackPatchCount > 0;
  if (partialPlane && err === 0) {
    d.push(
      diag(
        "HOUSE_GEOMETRY_PARTIAL",
        "info",
        "Plans partiels ou fallback présents — fiabilité géométrique non maximale.",
      ),
    );
  }
  if (
    input.topologyGraph.diagnostics.topologyBuildabilityLevel === "ambiguous" ||
    input.bindingResult.diagnostics.bindingConsistencyLevel === "ambiguous" ||
    input.intersectionSet.diagnostics.sewingLevel === "ambiguous"
  ) {
    d.push(diag("HOUSE_GEOMETRY_AMBIGUOUS", "warning", "Ambiguïtés structurelles (topo, binding ou coutures)."));
  }
  return d;
}

function deriveQualityLevel(
  totalErrors: number,
  totalWarnings: number,
  input: ValidateCanonicalHouse3DGeometryInput,
): CanonicalHouse3DQualityLevel {
  if (totalErrors > 0) return "invalid";
  const ambiguous =
    input.topologyGraph.diagnostics.topologyBuildabilityLevel === "ambiguous" ||
    input.bindingResult.diagnostics.bindingConsistencyLevel === "ambiguous" ||
    input.intersectionSet.diagnostics.sewingLevel === "ambiguous";
  if (ambiguous) return "ambiguous";
  const partial =
    input.intersectionSet.diagnostics.sewingLevel === "partial" ||
    input.bindingResult.diagnostics.bindingConsistencyLevel === "partial" ||
    input.solutionSet.diagnostics.partialPatchCount > 0 ||
    input.topologyGraph.diagnostics.topologyBuildabilityLevel === "partial";
  if (partial) return "partial";
  if (totalWarnings > 0) return "acceptable";
  return "clean";
}

/**
 * Valide la géométrie / topologie à partir des artefacts canoniques déjà construits.
 */
export function validateCanonicalHouse3DGeometry(
  input: ValidateCanonicalHouse3DGeometryInput,
): CanonicalHouse3DValidationReport {
  const buildingDiags = validateBuilding(input);
  const topologyDiags = validateRoofTopology(input.topologyGraph);
  const planesDiags = validateRoofPlanes(input.solutionSet, input.options);
  const interDiags = validateIntersections(input.intersectionSet);
  const bindDiags = validateBinding(input.bindingResult);
  const annexDiags = validateAnnexes(input.document);

  const globalDiags = validateGlobal(input, {
    building: buildingDiags,
    topology: topologyDiags,
    planes: planesDiags,
    intersections: interDiags,
    binding: bindDiags,
    annexes: annexDiags,
  });

  const buildingValidation = finalizeBlock(buildingDiags);
  const roofTopologyValidation = finalizeBlock(topologyDiags);
  const roofPlanesValidation = finalizeBlock(planesDiags);
  const roofIntersectionsValidation = finalizeBlock(interDiags);
  const roofBuildingBindingValidation = finalizeBlock(bindDiags);
  let roofAnnexesValidation = finalizeBlock(annexDiags);
  if (
    annexDiags.length === 1 &&
    annexDiags[0]!.code === "ANNEX_LAYER_MISSING_OPTIONAL"
  ) {
    roofAnnexesValidation = { ...roofAnnexesValidation, status: "skipped" };
  }
  const globalGeometryValidation = finalizeBlock(globalDiags);

  const allDiags = [
    ...buildingDiags,
    ...topologyDiags,
    ...planesDiags,
    ...interDiags,
    ...bindDiags,
    ...annexDiags,
    ...globalDiags,
  ];
  const errorCount = allDiags.filter((x) => x.severity === "error").length;
  const warningCount = allDiags.filter((x) => x.severity === "warning").length;
  const infoCount = allDiags.filter((x) => x.severity === "info").length;

  const globalQualityLevel = deriveQualityLevel(errorCount, warningCount, input);
  const globalValidity = errorCount === 0;

  const shellOk = Boolean(input.shellResult.shell) && input.shellResult.diagnostics.isClosedLateralShell;
  const isBuildableForViewer = shellOk && buildingValidation.errorCount === 0;

  const isBuildableForPremium3D =
    globalValidity &&
    globalQualityLevel !== "ambiguous" &&
    input.bindingResult.diagnostics.roofAttachedToBuilding &&
    input.intersectionSet.diagnostics.sewingLevel !== "invalid";

  const solvedRatio =
    input.solutionSet.diagnostics.solvedPatchCount /
    Math.max(1, input.solutionSet.diagnostics.patchCount);
  const isBuildableForShading =
    globalValidity &&
    solvedRatio >= 0.5 &&
    input.intersectionSet.diagnostics.sewingLevel !== "invalid" &&
    input.solutionSet.diagnostics.errors.length === 0;

  const annexErrors = annexDiags.filter((d) => d.severity === "error").length;
  const isBuildableForPV =
    isBuildableForShading && annexErrors === 0 && globalQualityLevel !== "ambiguous";

  return {
    schemaId: CANONICAL_HOUSE_3D_VALIDATION_REPORT_SCHEMA_ID,
    validatedAtIso: new Date().toISOString(),
    globalValidity,
    globalQualityLevel,
    isBuildableForViewer,
    isBuildableForPremium3D,
    isBuildableForShading,
    isBuildableForPV,
    errorCount,
    warningCount,
    infoCount,
    buildingValidation,
    roofTopologyValidation,
    roofPlanesValidation,
    roofIntersectionsValidation,
    roofBuildingBindingValidation,
    roofAnnexesValidation,
    globalGeometryValidation,
  };
}
