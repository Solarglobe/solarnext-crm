/**
 * Construction des surfaces 3D canoniques des panneaux PV à partir d’une entrée placement abstraite.
 * Pur, testable, non branché au moteur de pose runtime.
 */

import type { GeometryDiagnostic } from "../types/quality";
import type { QualityBlock } from "../types/quality";
import type { ConfidenceTier } from "../types/quality";
import type { PvPanelAttachment3D, PvPanelBuildResult, PvPanelSurface3D } from "../types/pv-panel-3d";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { BuildPvPanels3DContext, BuildPvPanels3DInput, PvPanelPlacementInput } from "./pvPanelInput";
import { NEAR_SHADING_SAMPLING } from "../../config/nearShadingConfig";
import { computePvPanelSpatialContext } from "./panelContextComputer";
import {
  buildPanelLocalFrame,
  buildSamplingGrid,
  moduleDimsAlongPatchUv,
  orthonormalPatchBasis,
  panelRectangleFromCenter,
  panelSurfaceAreaM2,
  resolveCenterOnPlaneWorld,
} from "./panelOnPlaneGeometry";

const DEG = Math.PI / 180;

function findPatch(patches: readonly RoofPlanePatch3D[], id: string): RoofPlanePatch3D | null {
  for (const p of patches) {
    if (p.id === id) return p;
  }
  return null;
}

function provenancePanel(id: string) {
  return { source: "solver" as const, solverStep: `buildPvPanels3D:panel:${id}` };
}

function buildOnePanel(
  input: PvPanelPlacementInput,
  patch: RoofPlanePatch3D,
  context: BuildPvPanels3DContext,
  globalDiag: GeometryDiagnostic[]
): PvPanelSurface3D | null {
  const { widthM, heightM } = input;
  if (!Number.isFinite(widthM) || !Number.isFinite(heightM) || widthM <= 0 || heightM <= 0) {
    globalDiag.push({
      code: "PV_PANEL_INVALID_DIMENSIONS",
      severity: "warning",
      message: `Panneau ${input.id} : dimensions invalides.`,
      context: { panelId: input.id },
    });
    return null;
  }

  const basis = orthonormalPatchBasis(patch);
  if (!basis) {
    globalDiag.push({
      code: "PV_PANEL_PATCH_BASIS_DEGRADED",
      severity: "warning",
      message: `Panneau ${input.id} : repère tangent du pan indéterminé.`,
      context: { panelId: input.id },
    });
    return null;
  }

  const { world: centerWorld, signedDistanceBeforeProjectionM } = resolveCenterOnPlaneWorld(
    input.center,
    patch,
    patch.equation
  );

  const { dimAlongU, dimAlongV } = moduleDimsAlongPatchUv(widthM, heightM, input.orientation);
  const rotationRad = input.rotationDegInPlane * DEG;
  const { corners, widthDir, heightDir } = panelRectangleFromCenter(
    centerWorld,
    basis.uHat,
    basis.vHat,
    dimAlongU,
    dimAlongV,
    rotationRad
  );

  const nx = Math.max(1, Math.floor(input.sampling?.nx ?? NEAR_SHADING_SAMPLING.nx));
  const ny = Math.max(1, Math.floor(input.sampling?.ny ?? NEAR_SHADING_SAMPLING.ny));
  const includeEdgeMidpoints = input.sampling?.includeEdgeMidpoints ?? false;

  const samplingGrid = buildSamplingGrid(
    centerWorld,
    widthDir,
    heightDir,
    dimAlongU,
    dimAlongV,
    corners,
    { nx, ny, includeEdgeMidpoints }
  );

  const localFrame = buildPanelLocalFrame(centerWorld, widthDir, heightDir, basis.nHat);

  const spatialContext = computePvPanelSpatialContext({
    patch,
    basis,
    panelCornersWorld: corners,
    centerWorld: centerWorld,
    structuralLineSegments: context.structuralLineSegments,
    obstacleVolumes: context.obstacleVolumes,
    extensionVolumes: context.extensionVolumes,
  });

  const diag: GeometryDiagnostic[] = [];
  if (Math.abs(signedDistanceBeforeProjectionM) > 0.05) {
    diag.push({
      code: "PV_PANEL_CENTER_PROJECTED",
      severity: "info",
      message: `Centre panneau ${input.id} : distance au plan avant projection ${signedDistanceBeforeProjectionM.toFixed(4)} m`,
      context: { signedDistanceM: signedDistanceBeforeProjectionM },
    });
  }

  if (spatialContext.patchBoundary.nearRoofBoundary) {
    diag.push({
      code: "PV_PANEL_NEAR_PATCH_BOUNDARY",
      severity: "info",
      message: `Panneau ${input.id} : proche du bord du pan (clearance ${spatialContext.patchBoundary.minDistanceToPatchBoundaryM?.toFixed(3) ?? "?"} m).`,
    });
  }
  if (!spatialContext.patchBoundary.cornersAllInsidePatchBoundary) {
    diag.push({
      code: "PV_PANEL_CORNER_OUTSIDE_PATCH",
      severity: "warning",
      message: `Panneau ${input.id} : au moins un coin du module sort du polygone du pan (projection UV).`,
    });
  }
  if (spatialContext.structuralLines.nearRidgeOrHip || spatialContext.structuralLines.nearRoofBreak) {
    diag.push({
      code: "PV_PANEL_NEAR_STRUCTURAL_LINE",
      severity: "info",
      message: `Panneau ${input.id} : proximité d’une ligne structurante (${spatialContext.structuralLines.nearestStructuralSemantic}).`,
    });
  }
  if (
    spatialContext.volumes.nearestObstacleDistanceM != null &&
    spatialContext.volumes.nearestObstacleDistanceM < 0.5
  ) {
    diag.push({
      code: "PV_PANEL_NEAR_OBSTACLE_VOLUME",
      severity: "info",
      message: `Panneau ${input.id} : obstacle volumique proche (distance AABB sous 0,5 m).`,
    });
  }
  if (spatialContext.volumes.footprintConflictHint) {
    diag.push({
      code: "PV_PANEL_VOLUME_AABB_OVERLAP_HINT",
      severity: "warning",
      message: `Panneau ${input.id} : chevauchement AABB possible avec un volume proche.`,
    });
  }

  let panelConfidence: ConfidenceTier = "high";
  if (spatialContext.geometricAnchorQuality === "weak") panelConfidence = "low";
  else if (spatialContext.geometricAnchorQuality === "moderate") panelConfidence = "medium";
  if (diag.some((d) => d.severity === "warning")) panelConfidence = panelConfidence === "high" ? "medium" : panelConfidence;

  const attachment: PvPanelAttachment3D = {
    roofPlanePatchId: patch.id,
    kind:
      Math.abs(signedDistanceBeforeProjectionM) > 0.05 ? "center_projected_onto_plane" : "single_plane_resolved",
    relationHint: "seated_on_single_plane",
    signedDistanceCenterToPlaneM: signedDistanceBeforeProjectionM,
  };

  return {
    id: input.id,
    corners3D: corners,
    center3D: { ...centerWorld },
    outwardNormal: { ...basis.nHat },
    planeEquation: { ...patch.equation },
    localFrame,
    widthM,
    heightM,
    surfaceAreaM2: panelSurfaceAreaM2(widthM, heightM),
    attachment,
    pose: {
      orientation: input.orientation,
      rotationDegInPlane: input.rotationDegInPlane,
      widthM,
      heightM,
      blockGroupId: input.blockGroupId,
    },
    samplingGrid,
    spatialContext,
    provenance: provenancePanel(input.id),
    quality: {
      confidence: panelConfidence,
      diagnostics: diag,
    },
  };
}

/**
 * Produit une surface 3D par panneau listé, avec grille d’échantillonnage et rattachement au pan.
 * Les panneaux dont le `roofPlanePatchId` est introuvable sont omis (diagnostic global).
 */
export function buildPvPanels3D(input: BuildPvPanels3DInput, context: BuildPvPanels3DContext): PvPanelBuildResult {
  const panels: PvPanelSurface3D[] = [];
  const globalDiag: GeometryDiagnostic[] = [];

  if (!context.roofPlanePatches.length) {
    globalDiag.push({
      code: "PV_PANEL_NO_PLANE_CONTEXT",
      severity: "warning",
      message: "Aucun RoofPlanePatch3D fourni — aucun panneau 3D généré.",
    });
    return { panels: [], globalQuality: { confidence: "low", diagnostics: globalDiag } };
  }

  for (const p of input.panels) {
    const patch = findPatch(context.roofPlanePatches, p.roofPlanePatchId);
    if (!patch) {
      globalDiag.push({
        code: "PV_PANEL_PLANE_PATCH_NOT_FOUND",
        severity: "warning",
        message: `Panneau ${p.id} : pan « ${p.roofPlanePatchId} » introuvable.`,
        context: { panelId: p.id, roofPlanePatchId: p.roofPlanePatchId },
      });
      continue;
    }
    const built = buildOnePanel(p, patch, context, globalDiag);
    if (built) panels.push(built);
  }

  globalDiag.push({
    code: "PV_PANEL_BUILD_STRATEGY",
    severity: "info",
    message:
      "Panneaux 3D : quad planaire + contexte spatial (bord de pan UV, segments structurants optionnels, volumes AABB optionnels).",
  });

  let confidence: QualityBlock["confidence"] = "high";
  if (globalDiag.some((d) => d.severity === "warning")) confidence = "medium";

  return { panels, globalQuality: { confidence, diagnostics: globalDiag } };
}
