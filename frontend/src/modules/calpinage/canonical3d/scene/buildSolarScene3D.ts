/**
 * Construction de `SolarScene3D` à partir des résultats builders du noyau — aucune géométrie recalculée.
 *
 * Contrat pipeline : docs/architecture/canonical-pipeline.md (agrégation scène ; shading / solar optionnels).
 */

import type { RoofModel3D } from "../types/model";
import type { QualityBlock } from "../types/quality";
import type { NearShadingSeriesResult } from "../types/near-shading-3d";
import type { NearShadingSolarDirectionInput } from "../types/near-shading-3d";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { BuildingShell3D } from "../types/building-shell-3d";
import type { Vector3 } from "../types/primitives";
import { normalize3 } from "../utils/math3";
import type { PanelVisualShading, PanelVisualShadingSummary } from "../types/panelVisualShading";
import type {
  SolarScene3D,
  SolarScene3DMetadata,
  SolarSceneBuildGuard,
  SolarSceneGenerator,
  SolarScenePanelShadingSummary,
  SolarSceneRoofGeometrySource,
  SolarSceneRoofQualityPhaseA,
  SolarSceneRoofQualityPhaseB,
  SolarSceneShadingSnapshot3D,
  SolarSceneSolarContext3D,
} from "../types/solarScene3d";
import { SOLAR_SCENE_3D_SCHEMA_VERSION } from "../types/solarScene3d";
import type { CanonicalWorldConfig } from "../world/worldConvention";
import type { Scene2DSourceTrace } from "../types/scene2d3dCoherence";
import { validate2DTo3DCoherence } from "../validation/validate2DTo3DCoherence";

export interface BuildSolarScene3DInput {
  readonly worldConfig?: CanonicalWorldConfig;
  readonly roofModel: RoofModel3D;
  readonly obstacleVolumes: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes: readonly RoofExtensionVolume3D[];
  readonly volumesQuality: QualityBlock;
  readonly pvPanels: readonly PvPanelSurface3D[];
  /** Directions soleil (vers le soleil) — sérialisées dans solarContext. */
  readonly solarDirections?: readonly NearShadingSolarDirectionInput[];
  readonly solarSamplingKind?: SolarSceneSolarContext3D["samplingKind"];
  readonly solarDescription?: string;
  readonly nearShadingSeries?: NearShadingSeriesResult;
  readonly nearShadingEngineId?: SolarSceneShadingSnapshot3D["engineId"];
  readonly studyRef?: string;
  readonly integrationNotes?: string;
  readonly generator?: SolarSceneGenerator;
  /** Trace source 2D / ids métier — pour validation de fidélité (`scene.coherence.confidence`). */
  readonly sourceTrace?: Scene2DSourceTrace;
  /** Lecture seule runtime / export — coloration viewer sans recalcul ombrage. */
  readonly panelVisualShadingByPanelId?: Readonly<Record<string, PanelVisualShading>>;
  readonly panelVisualShadingSummary?: PanelVisualShadingSummary;
  readonly roofGeometrySource?: SolarSceneRoofGeometrySource;
  readonly roofGeometryFallbackReason?: string | null;
  /** Prisme bâtiment (runtime calpinage) — optionnel. */
  readonly buildingShell?: BuildingShell3D | null;
  /** Garde-fous niveau 0 — audit / bandeau viewer (optionnel). */
  readonly buildGuards?: readonly SolarSceneBuildGuard[];
  /** Plan d’action Phase A (correctifs 2D) — optionnel. */
  readonly roofQualityPhaseA?: SolarSceneRoofQualityPhaseA;
  /** Preuve technique Phase B (métriques, export support) — optionnel. */
  readonly roofQualityPhaseB?: SolarSceneRoofQualityPhaseB;
}

function summarizePanelsFromNearSeries(
  series: NearShadingSeriesResult
): Record<string, SolarScenePanelShadingSummary> {
  const byId: Record<string, { samples: number[]; mins: number[]; maxs: number[] }> = {};
  for (const step of series.annual.timestepResults) {
    for (const pr of step.panelResults) {
      const id = String(pr.panelId);
      if (!byId[id]) {
        byId[id] = { samples: [], mins: [], maxs: [] };
      }
      byId[id].samples.push(pr.shadingRatio);
      byId[id].mins.push(pr.shadingRatio);
      byId[id].maxs.push(pr.shadingRatio);
    }
  }
  const out: Record<string, SolarScenePanelShadingSummary> = {};
  for (const [id, agg] of Object.entries(byId)) {
    const mean =
      agg.samples.length > 0
        ? agg.samples.reduce((a, b) => a + b, 0) / agg.samples.length
        : 0;
    out[id] = {
      meanShadedFraction: mean,
      minShadedFraction: agg.mins.length ? Math.min(...agg.mins) : 0,
      maxShadedFraction: agg.maxs.length ? Math.max(...agg.maxs) : 0,
    };
  }
  return out;
}

function buildSolarDirectionsUnit(
  dirs: readonly NearShadingSolarDirectionInput[]
): readonly Vector3[] {
  const out: Vector3[] = [];
  for (const s of dirs) {
    const u = normalize3(s.directionTowardSunWorld);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Assemble une scène 3D produit à partir du noyau canonical3d déjà calculé.
 */
export function buildSolarScene3D(input: BuildSolarScene3DInput): SolarScene3D {
  const createdAtIso = new Date().toISOString();
  const meta: SolarScene3DMetadata = {
    schemaVersion: SOLAR_SCENE_3D_SCHEMA_VERSION,
    createdAtIso,
    generator: input.generator ?? "buildSolarScene3D",
    ...(input.studyRef != null && { studyRef: input.studyRef }),
    ...(input.integrationNotes != null && { integrationNotes: input.integrationNotes }),
    ...(input.roofGeometrySource != null && { roofGeometrySource: input.roofGeometrySource }),
    ...(input.roofGeometryFallbackReason !== undefined && {
      roofGeometryFallbackReason: input.roofGeometryFallbackReason,
    }),
    ...(input.buildGuards != null &&
      input.buildGuards.length > 0 && { buildGuards: input.buildGuards }),
    ...(input.roofQualityPhaseA != null && { roofQualityPhaseA: input.roofQualityPhaseA }),
    ...(input.roofQualityPhaseB != null && { roofQualityPhaseB: input.roofQualityPhaseB }),
  };

  let solarContext: SolarSceneSolarContext3D | undefined;
  if (input.solarDirections && input.solarDirections.length > 0) {
    solarContext = {
      directionsTowardSunUnit: buildSolarDirectionsUnit(input.solarDirections),
      samplingKind: input.solarSamplingKind ?? "custom",
      ...(input.solarDescription != null && { description: input.solarDescription }),
    };
  }

  let nearShadingSnapshot: SolarSceneShadingSnapshot3D | undefined;
  if (input.nearShadingSeries) {
    nearShadingSnapshot = {
      engineId: input.nearShadingEngineId ?? "canonical_near_raycast_v1",
      seriesResult: input.nearShadingSeries,
      panelShadingSummaryById: summarizePanelsFromNearSeries(input.nearShadingSeries),
    };
  }

  const base: SolarScene3D = {
    metadata: meta,
    ...(input.worldConfig != null && { worldConfig: input.worldConfig }),
    ...(input.sourceTrace != null && { sourceTrace: input.sourceTrace }),
    roofModel: input.roofModel,
    ...(input.buildingShell != null ? { buildingShell: input.buildingShell } : {}),
    obstacleVolumes: input.obstacleVolumes,
    extensionVolumes: input.extensionVolumes,
    volumesQuality: input.volumesQuality,
    pvPanels: input.pvPanels,
    ...(input.panelVisualShadingByPanelId != null && {
      panelVisualShadingByPanelId: input.panelVisualShadingByPanelId,
    }),
    ...(input.panelVisualShadingSummary != null && {
      panelVisualShadingSummary: input.panelVisualShadingSummary,
    }),
    ...(solarContext && { solarContext }),
    ...(nearShadingSnapshot && { nearShadingSnapshot }),
  };

  if (import.meta.env.DEV && input.buildingShell != null) {
    const sh = input.buildingShell;
    console.info("[HOUSE3D-FIX][SCENE]", {
      buildingShellInjected: true,
      contourSource: sh.contourSource,
      shellVertices: sh.vertices.length,
      shellFaces: sh.faces.length,
      shellMinZ: Number(sh.bounds.min.z.toFixed(4)),
      shellMaxZ: Number(sh.bounds.max.z.toFixed(4)),
      lateralWallFaces: sh.faces.filter((f) => f.kind === "side").length,
      roofPatchCount: input.roofModel.roofPlanePatches.length,
    });
  }

  const coherence = validate2DTo3DCoherence(base);
  return {
    ...base,
    coherence,
  };
}

/** Alias explicite pour export / documentation. */
export const exportCanonicalScene3D = buildSolarScene3D;
