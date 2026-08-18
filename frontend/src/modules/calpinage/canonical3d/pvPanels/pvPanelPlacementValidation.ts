import type { WorldPosition3D } from "../types/coordinates";
import type {
  PvPanelInvalidPlacementReason,
  PvPanelPlacementValidity3D,
  PvPanelSurface3D,
} from "../types/pv-panel-3d";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { GeometryDiagnostic, PvPanelPlacementValidityStatus, QualityBlock } from "../types/quality";
import { dot3 } from "../utils/math3";

export const PV_PLACEMENT_PLANE_DISTANCE_TOLERANCE_M = 1e-5;
export const PV_PLACEMENT_ORIENTATION_DOT_TOLERANCE = 1e-4;

function signedDistanceToPatchPlane(p: WorldPosition3D, patch: RoofPlanePatch3D): number {
  return dot3(patch.equation.normal, p) + patch.equation.d;
}

function finitePoint(p: WorldPosition3D): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

export function validatePvPanelPlacementOnPatch(
  panel: PvPanelSurface3D,
  patch: RoofPlanePatch3D | null,
  duplicatePanelId = false,
): PvPanelPlacementValidity3D {
  const reasons: PvPanelInvalidPlacementReason[] = [];

  if (!patch) {
    reasons.push("roof_patch_not_found");
    return {
      status: "INVALID",
      reasons,
      distanceCenterToPlaneM: Infinity,
      maxCornerDistanceToPlaneM: Infinity,
    };
  }

  if (!Number.isFinite(panel.widthM) || !Number.isFinite(panel.heightM) || panel.widthM <= 0 || panel.heightM <= 0) {
    reasons.push("invalid_dimensions");
  }
  if (!finitePoint(panel.center3D) || panel.corners3D.some((p) => !finitePoint(p))) {
    reasons.push("non_finite_coordinates");
  }

  const centerDistance = Math.abs(signedDistanceToPatchPlane(panel.center3D, patch));
  let maxCornerDistance = 0;
  for (const corner of panel.corners3D) {
    maxCornerDistance = Math.max(maxCornerDistance, Math.abs(signedDistanceToPatchPlane(corner, patch)));
  }
  if (centerDistance > PV_PLACEMENT_PLANE_DISTANCE_TOLERANCE_M) reasons.push("center_off_plane");
  if (maxCornerDistance > PV_PLACEMENT_PLANE_DISTANCE_TOLERANCE_M) reasons.push("corner_off_plane");

  const spatial = panel.spatialContext;
  if (!spatial.patchBoundary.centerInsidePatchBoundary || !spatial.patchBoundary.cornersAllInsidePatchBoundary) {
    reasons.push("outside_roof_surface");
  }
  if (spatial.volumes.footprintConflictHint) {
    reasons.push("intersects_keepout_volume");
  }

  const normalDot = dot3(panel.outwardNormal, patch.normal);
  if (!Number.isFinite(normalDot) || Math.abs(1 - normalDot) > PV_PLACEMENT_ORIENTATION_DOT_TOLERANCE) {
    reasons.push("orientation_mismatch");
  }
  if (duplicatePanelId) {
    reasons.push("duplicate_panel_id");
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    status: uniqueReasons.length > 0 ? "INVALID" : "VALID",
    reasons: uniqueReasons,
    distanceCenterToPlaneM: centerDistance,
    maxCornerDistanceToPlaneM: maxCornerDistance,
  };
}

export interface PvPanelScenePlacementValidation {
  readonly status: PvPanelPlacementValidityStatus;
  readonly invalidPanelCount: number;
  readonly droppedPanelCount: number;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export function evaluatePvPanelPlacementsForScene(args: {
  readonly panels: readonly PvPanelSurface3D[];
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  readonly requestedPanelCount?: number;
  readonly obstacleVolumes?: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes?: readonly RoofExtensionVolume3D[];
}): PvPanelScenePlacementValidation {
  const patchById = new Map(args.roofPlanePatches.map((p) => [String(p.id), p] as const));
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const panel of args.panels) {
    const id = String(panel.id);
    if (seen.has(id)) duplicateIds.add(id);
    seen.add(id);
  }

  const diagnostics: GeometryDiagnostic[] = [];
  let invalidPanelCount = 0;

  for (const panel of args.panels) {
    const patchId = String(panel.attachment.roofPlanePatchId);
    const validity = validatePvPanelPlacementOnPatch(panel, patchById.get(patchId) ?? null, duplicateIds.has(String(panel.id)));
    if (validity.status === "INVALID") {
      invalidPanelCount++;
      diagnostics.push({
        code: "PV_PANEL_PLACEMENT_INVALID",
        severity: "error",
        message: `Panneau ${panel.id} : placement PV invalide (${validity.reasons.join(", ")}).`,
        context: {
          panelId: String(panel.id),
          roofPlanePatchId: patchId,
          distanceCenterToPlaneM: validity.distanceCenterToPlaneM,
          maxCornerDistanceToPlaneM: validity.maxCornerDistanceToPlaneM,
        },
      });
    }
  }

  const requested = args.requestedPanelCount ?? args.panels.length;
  const droppedPanelCount = Math.max(0, requested - args.panels.length);
  if (droppedPanelCount > 0) {
    diagnostics.push({
      code: "PV_PANEL_PLACEMENT_DROPPED",
      severity: "error",
      message: `${droppedPanelCount} panneau(x) PV ignoré(s) avant génération 3D.`,
      context: { requestedPanelCount: requested, builtPanelCount: args.panels.length },
    });
  }

  return {
    status: invalidPanelCount > 0 || droppedPanelCount > 0 ? "INVALID" : "VALID",
    invalidPanelCount,
    droppedPanelCount,
    diagnostics,
  };
}

export function mergePvPlacementQuality(
  quality: QualityBlock,
  validity: PvPanelPlacementValidity3D,
): QualityBlock {
  if (validity.status === "VALID") return quality;
  const diagnostics: GeometryDiagnostic[] = [
    ...quality.diagnostics,
    {
      code: "PV_PANEL_PLACEMENT_INVALID",
      severity: "error",
      message: `Placement PV invalide (${validity.reasons.join(", ")}).`,
      context: {
        distanceCenterToPlaneM: validity.distanceCenterToPlaneM,
        maxCornerDistanceToPlaneM: validity.maxCornerDistanceToPlaneM,
      },
    },
  ];
  return { confidence: "low", diagnostics };
}
