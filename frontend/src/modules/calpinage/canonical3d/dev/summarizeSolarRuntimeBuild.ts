/**
 * Lecture compacte du résultat `buildSolarScene3DFromCalpinageRuntime` — tests & debug /dev/3d.
 * Pas de score magique : compteurs et codes stables uniquement.
 */

import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";

type BuildResult = ReturnType<typeof buildSolarScene3DFromCalpinageRuntime>;

export type SolarRuntimeBuildQualitySummary = {
  readonly caseId: string;
  readonly buildOk: boolean;
  readonly is3DEligible: boolean;
  readonly scenePresent: boolean;
  readonly roofPlanePatchCount: number;
  readonly roofRidge3dCount: number;
  readonly pvPanelCount: number;
  readonly obstacleVolumeCount: number;
  readonly extensionVolumeCount: number;
  readonly coherenceIsCoherent: boolean | null;
  readonly worldConfigPresent: boolean;
  readonly sourceTraceSourcePanCount: number;
  readonly validationErrorCodes: readonly string[];
  readonly validationWarningCount: number;
  readonly validationStatsPanCount: number;
  readonly validationStatsPanelCount: number;
  readonly validationStatsObstacleCount: number;
};

export function summarizeSolarRuntimeBuild(caseId: string, res: BuildResult): SolarRuntimeBuildQualitySummary {
  const scene = res.scene;
  const stats = res.diagnostics.stats;
  return {
    caseId,
    buildOk: res.ok,
    is3DEligible: res.is3DEligible,
    scenePresent: scene != null,
    roofPlanePatchCount: scene?.roofModel.roofPlanePatches.length ?? 0,
    roofRidge3dCount: scene?.roofModel.roofRidges.length ?? 0,
    pvPanelCount: scene?.pvPanels.length ?? 0,
    obstacleVolumeCount: scene?.obstacleVolumes.length ?? 0,
    extensionVolumeCount: scene?.extensionVolumes.length ?? 0,
    coherenceIsCoherent: scene?.coherence != null ? scene.coherence.isCoherent : null,
    worldConfigPresent: scene?.worldConfig != null,
    sourceTraceSourcePanCount: scene?.sourceTrace?.sourcePanIds.length ?? 0,
    validationErrorCodes: res.diagnostics.errors.map((e) => e.code),
    validationWarningCount: res.diagnostics.warnings.length,
    validationStatsPanCount: stats.panCount,
    validationStatsPanelCount: stats.panelCount,
    validationStatsObstacleCount: stats.obstacleCount,
  };
}
