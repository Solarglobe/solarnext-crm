/**
 * Builder volumique canonique : empreintes + hauteur → prismes 3D, avec ancrage optionnel sur les pans.
 *
 * Non branché au runtime CRM ; pur et testable.
 */

import type { GeometryDiagnostic } from "../types/quality";
import type { QualityBlock } from "../types/quality";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { ObstacleVolumeExtrusionMode } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { AxisAlignedBounds3D } from "../types/volumetric-mesh";
import type { VolumeRoofAttachment } from "../types/volume-roof-attachment";
import type { VolumeExtrusionChoice } from "../types/volume-roof-attachment";
import { vec3, normalize3 } from "../utils/math3";
import { extrudeVerticalPrismWorld } from "./extrudeVerticalPrism";
import { extrudePrismAlongUnitDirection } from "./extrudePrismAlongAxis";
import { resolveFootprintHorizontalWorld } from "./footprintWorld";
import { projectFootprintOntoPlane, resolvePlanePatchByRelatedIds } from "./planeAnchor";
import type {
  BuildRoofVolumes3DContext,
  BuildRoofVolumes3DInput,
  LegacyExtensionVolumeInput,
  LegacyObstacleVolumeInput,
  VolumeExtrusionPreference,
} from "./volumeInput";

const UP = vec3(0, 0, 1);

export interface BuildRoofVolumes3DResult {
  readonly obstacleVolumes: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly globalQuality: QualityBlock;
}

function provenanceObstacle(id: string) {
  return { source: "solver" as const, solverStep: `buildRoofVolumes3D:obstacle:${id}` };
}

function provenanceExtension(id: string) {
  return { source: "solver" as const, solverStep: `buildRoofVolumes3D:extension:${id}` };
}

function preferenceToMode(
  pref: VolumeExtrusionPreference | undefined,
  planeResolved: boolean
): ObstacleVolumeExtrusionMode {
  const p = pref ?? "auto";
  if (p === "vertical_world_z") return "vertical_world_z";
  if (p === "along_pan_normal") return planeResolved ? "along_pan_normal" : "vertical_world_z";
  if (p === "hybrid_vertical_on_plane") return planeResolved ? "hybrid_vertical_on_plane" : "vertical_world_z";
  /* auto */
  return planeResolved ? "along_pan_normal" : "vertical_world_z";
}

function extrusionChoiceFromMode(mode: ObstacleVolumeExtrusionMode): VolumeExtrusionChoice {
  if (mode === "along_pan_normal") return "along_pan_normal";
  if (mode === "hybrid_vertical_on_plane") return "hybrid_vertical_base_on_plane";
  return "vertical_world_z";
}

function meanZFootprint(pts: readonly { x: number; y: number; z: number }[]): number {
  let s = 0;
  for (const p of pts) s += p.z;
  return s / pts.length;
}

function buildAttachment(
  primaryId: string | null,
  related: readonly string[] | undefined,
  anchorKind: VolumeRoofAttachment["anchorKind"],
  relationHint: VolumeRoofAttachment["relationHint"],
  choice: VolumeExtrusionChoice,
  maxD?: number
): VolumeRoofAttachment {
  return {
    primaryPlanePatchId: primaryId,
    affectedPlanePatchIds: related ?? [],
    anchorKind,
    relationHint,
    extrusionChoice: choice,
    maxPreProjectionPlaneDistanceM: maxD,
  };
}

type MeshPack = {
  vertices: RoofObstacleVolume3D["vertices"];
  edges: RoofObstacleVolume3D["edges"];
  faces: RoofObstacleVolume3D["faces"];
  bounds: AxisAlignedBounds3D;
  centroid: RoofObstacleVolume3D["centroid"];
  surfaceAreaM2: number;
  volumeM3: number;
  footprintWorld: RoofObstacleVolume3D["footprintWorld"];
  baseElevationM: number;
  extrusion: RoofObstacleVolume3D["extrusion"];
};

function buildObstacleMeshAndMeta(
  o: LegacyObstacleVolumeInput,
  context: BuildRoofVolumes3DContext | undefined,
  globalDiag: GeometryDiagnostic[]
): MeshPack | null {
  const fp = resolveFootprintHorizontalWorld(o.footprint, 0);
  if (fp.footprintHorizontal.length < 3 || !Number.isFinite(o.heightM) || o.heightM <= 0) {
    return null;
  }

  const patch = resolvePlanePatchByRelatedIds(o.relatedPlanePatchIds, context?.roofPlanePatches);
  const planeResolved = patch != null;
  let mode = preferenceToMode(o.extrusionPreference, planeResolved);

  if ((o.extrusionPreference === "along_pan_normal" || o.extrusionPreference === "hybrid_vertical_on_plane") && !planeResolved) {
    globalDiag.push({
      code: "VOLUME_PAN_REQUIRED_FOR_PREFERENCE",
      severity: "warning",
      message: `Obstacle ${o.id} : extrusion ${o.extrusionPreference} demandée mais pan non résolu — repli +Z monde.`,
      context: { obstacleId: o.id },
    });
    mode = "vertical_world_z";
  }

  const prefix = `obs-${o.id}`;
  let mesh: MeshPack;

  if (planeResolved && patch && mode === "along_pan_normal") {
    const { projected, maxAbsDistanceM } = projectFootprintOntoPlane(fp.footprintHorizontal, patch.equation);
    const nu = normalize3(patch.normal) ?? patch.normal;
    const g = extrudePrismAlongUnitDirection(projected, nu, o.heightM, prefix);
    if (g.vertices.length === 0) return null;
    mesh = {
      vertices: g.vertices,
      edges: g.edges,
      faces: g.faces,
      bounds: g.bounds as AxisAlignedBounds3D,
      centroid: g.centroid,
      surfaceAreaM2: g.surfaceAreaM2,
      volumeM3: g.volumeM3,
      footprintWorld: projected,
      baseElevationM: meanZFootprint(projected),
      extrusion: { mode: "along_pan_normal", directionWorld: { ...nu } },
    };
    if (maxAbsDistanceM > 0.25) {
      globalDiag.push({
        code: "VOLUME_PROJECTION_LARGE_GAP",
        severity: "info",
        message: `Obstacle ${o.id} : écart max au plan du pan avant projection ${maxAbsDistanceM.toFixed(3)} m`,
        context: { obstacleId: o.id, maxAbsDistanceM },
      });
    }
    return mesh;
  }

  if (planeResolved && patch && mode === "hybrid_vertical_on_plane") {
    const { projected, maxAbsDistanceM } = projectFootprintOntoPlane(fp.footprintHorizontal, patch.equation);
    const g = extrudeVerticalPrismWorld(projected, o.heightM, prefix);
    if (g.vertices.length === 0) return null;
    mesh = {
      vertices: g.vertices,
      edges: g.edges,
      faces: g.faces,
      bounds: g.bounds as AxisAlignedBounds3D,
      centroid: g.centroid,
      surfaceAreaM2: g.surfaceAreaM2,
      volumeM3: g.volumeM3,
      footprintWorld: projected,
      baseElevationM: meanZFootprint(projected),
      extrusion: { mode: "hybrid_vertical_on_plane", directionWorld: { ...UP } },
    };
    if (maxAbsDistanceM > 0.25) {
      globalDiag.push({
        code: "VOLUME_PROJECTION_LARGE_GAP",
        severity: "info",
        message: `Obstacle ${o.id} : écart max au plan du pan avant projection ${maxAbsDistanceM.toFixed(3)} m`,
        context: { obstacleId: o.id, maxAbsDistanceM },
      });
    }
    return mesh;
  }

  const g = extrudeVerticalPrismWorld(fp.footprintHorizontal, o.heightM, prefix);
  if (g.vertices.length === 0) return null;
  return {
    vertices: g.vertices,
    edges: g.edges,
    faces: g.faces,
    bounds: g.bounds as AxisAlignedBounds3D,
    centroid: g.centroid,
    surfaceAreaM2: g.surfaceAreaM2,
    volumeM3: g.volumeM3,
    footprintWorld: fp.footprintHorizontal,
    baseElevationM: fp.baseElevationM,
    extrusion: { mode: "vertical_world_z", directionWorld: { ...UP } },
  };
}

function buildObstacleVolume(
  o: LegacyObstacleVolumeInput,
  context: BuildRoofVolumes3DContext | undefined,
  globalDiag: GeometryDiagnostic[]
): RoofObstacleVolume3D | null {
  const mesh = buildObstacleMeshAndMeta(o, context, globalDiag);
  if (!mesh) return null;

  const patch = resolvePlanePatchByRelatedIds(o.relatedPlanePatchIds, context?.roofPlanePatches);
  const planeResolved = patch != null;
  const mode = mesh.extrusion.mode;
  const choice = extrusionChoiceFromMode(mode);

  let anchorKind: VolumeRoofAttachment["anchorKind"] = "no_plane_context";
  let relationHint: VolumeRoofAttachment["relationHint"] = "extrusion_world_vertical_only";
  let maxD: number | undefined;

  if (context?.roofPlanePatches?.length && !o.relatedPlanePatchIds?.length) {
    anchorKind = "no_plane_context";
  } else if (planeResolved && patch) {
    if (mode === "vertical_world_z") {
      anchorKind = "fallback_world_vertical";
      relationHint = "extrusion_world_vertical_only";
    } else {
      const proj = projectFootprintOntoPlane(mesh.footprintWorld, patch.equation);
      maxD = proj.maxAbsDistanceM;
      anchorKind = maxD > 0.05 ? "anchored_projection_only" : "anchored_single_plane";
      relationHint =
        mode === "along_pan_normal" ? "extrusion_along_pan_normal" : "hybrid_vertical_base_on_sloped_plane";
    }
  } else if (o.relatedPlanePatchIds?.length) {
    anchorKind = "primary_plane_not_found";
    relationHint = "unknown";
  }

  const diag: GeometryDiagnostic[] = mesh.footprintWorld.length > 4
    ? [
        {
          code: "VOLUME_PRISM_TRIANGULATION_FAN",
          severity: "info",
          message:
            "Triangulation base/haut en éventail depuis l’indice 0 — fiable pour polygone convexe ; vérifier les cas non convexes.",
          context: { vertexCount: mesh.footprintWorld.length },
        },
      ]
    : [];

  diag.push({
    code: "VOLUME_EXTRUSION_MODE",
    severity: "info",
    message: `Mode extrusion : ${mode} (${choice}).`,
    context: { mode: mode === "vertical_world_z" ? 0 : mode === "along_pan_normal" ? 1 : 2 },
  });

  return {
    id: o.id,
    kind: o.kind,
    structuralRole: o.structuralRole,
    baseElevationM: mesh.baseElevationM,
    heightM: o.heightM,
    extrusion: mesh.extrusion,
    footprintWorld: mesh.footprintWorld,
    vertices: mesh.vertices,
    edges: mesh.edges,
    faces: mesh.faces,
    bounds: mesh.bounds,
    centroid: mesh.centroid,
    surfaceAreaM2: mesh.surfaceAreaM2,
    volumeM3: mesh.volumeM3,
    relatedPlanePatchIds: o.relatedPlanePatchIds ?? [],
    roofAttachment: buildAttachment(
      patch?.id ?? null,
      o.relatedPlanePatchIds,
      anchorKind,
      relationHint,
      choice,
      maxD
    ),
    provenance: provenanceObstacle(o.id),
    quality: {
      confidence: "high",
      diagnostics: diag,
    },
  };
}

function buildExtensionVolume(
  e: LegacyExtensionVolumeInput,
  context: BuildRoofVolumes3DContext | undefined,
  globalDiag: GeometryDiagnostic[]
): RoofExtensionVolume3D | null {
  const oLike: LegacyObstacleVolumeInput = {
    id: e.id,
    kind: "other",
    structuralRole: "obstacle_structuring",
    heightM: e.heightM,
    footprint: e.footprint,
    relatedPlanePatchIds: e.relatedPlanePatchIds,
    extrusionPreference: e.extrusionPreference,
  };
  const mesh = buildObstacleMeshAndMeta(oLike, context, globalDiag);
  if (!mesh) return null;

  const patch = resolvePlanePatchByRelatedIds(e.relatedPlanePatchIds, context?.roofPlanePatches);
  const planeResolved = patch != null;
  const mode = mesh.extrusion.mode;
  const choice = extrusionChoiceFromMode(mode);

  let anchorKind: VolumeRoofAttachment["anchorKind"] = "no_plane_context";
  let relationHint: VolumeRoofAttachment["relationHint"] = "extrusion_world_vertical_only";
  let maxD: number | undefined;

  if (planeResolved && patch && mode !== "vertical_world_z") {
    const proj = projectFootprintOntoPlane(mesh.footprintWorld, patch.equation);
    maxD = proj.maxAbsDistanceM;
    anchorKind = maxD > 0.05 ? "anchored_projection_only" : "anchored_single_plane";
    relationHint =
      mode === "along_pan_normal" ? "extrusion_along_pan_normal" : "hybrid_vertical_base_on_sloped_plane";
  } else if (planeResolved && patch && mode === "vertical_world_z") {
    anchorKind = "fallback_world_vertical";
  } else if (e.relatedPlanePatchIds?.length) {
    anchorKind = "primary_plane_not_found";
  }

  const diag: GeometryDiagnostic[] = mesh.footprintWorld.length > 4
    ? [
        {
          code: "VOLUME_PRISM_TRIANGULATION_FAN",
          severity: "info",
          message:
            "Triangulation base/haut en éventail depuis l’indice 0 — fiable pour polygone convexe ; vérifier les cas non convexes.",
          context: { vertexCount: mesh.footprintWorld.length },
        },
      ]
    : [];

  return {
    id: e.id,
    kind: e.kind,
    structuralRole: "roof_extension",
    baseElevationM: mesh.baseElevationM,
    heightM: e.heightM,
    extrusion: mesh.extrusion,
    footprintWorld: mesh.footprintWorld,
    vertices: mesh.vertices,
    edges: mesh.edges,
    faces: mesh.faces,
    bounds: mesh.bounds,
    centroid: mesh.centroid,
    surfaceAreaM2: mesh.surfaceAreaM2,
    volumeM3: mesh.volumeM3,
    relatedPlanePatchIds: e.relatedPlanePatchIds ?? [],
    roofAttachment: buildAttachment(
      patch?.id ?? null,
      e.relatedPlanePatchIds,
      anchorKind,
      relationHint,
      choice,
      maxD
    ),
    parentModelRef: e.parentModelRef,
    provenance: provenanceExtension(e.id),
    quality: {
      confidence: "high",
      diagnostics: diag,
    },
  };
}

/**
 * Construit les volumes 3D canoniques. Sans `context.roofPlanePatches`, comportement identique au repli +Z monde.
 */
export function buildRoofVolumes3D(
  input: BuildRoofVolumes3DInput,
  context?: BuildRoofVolumes3DContext
): BuildRoofVolumes3DResult {
  const obstacleVolumes: RoofObstacleVolume3D[] = [];
  const extensionVolumes: RoofExtensionVolume3D[] = [];
  const globalDiag: GeometryDiagnostic[] = [];

  for (const o of input.obstacles) {
    const v = buildObstacleVolume(o, context, globalDiag);
    if (v) obstacleVolumes.push(v);
    else {
      globalDiag.push({
        code: "OBSTACLE_VOLUME_SKIPPED",
        severity: "warning",
        message: `Obstacle ${o.id} : footprint ou hauteur invalide — volume non généré`,
        context: { entityId: o.id },
      });
    }
  }

  for (const e of input.extensions) {
    const v = buildExtensionVolume(e, context, globalDiag);
    if (v) extensionVolumes.push(v);
    else {
      globalDiag.push({
        code: "EXTENSION_VOLUME_SKIPPED",
        severity: "warning",
        message: `Extension ${e.id} : footprint ou hauteur invalide — volume non généré`,
        context: { entityId: e.id },
      });
    }
  }

  globalDiag.push({
    code: "VOLUME_BUILD_STRATEGY",
    severity: "info",
    message:
      "Volumes : prisme avec ancrage optionnel sur `RoofPlanePatch3D` (projection + extrusion selon normale pan, ou hybride +Z sur base projetée, ou repli +Z monde).",
  });

  let confidence: QualityBlock["confidence"] = "high";
  if (globalDiag.some((d) => d.severity === "warning")) confidence = "medium";

  return {
    obstacleVolumes,
    extensionVolumes,
    globalQuality: { confidence, diagnostics: globalDiag },
  };
}
