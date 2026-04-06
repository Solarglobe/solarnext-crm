/**
 * Résumé « readiness » chaîne runtime → scène 3D + shading visuel + inspection (tests / dev).
 */

import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { summarizeSolarRuntimeBuild, type SolarRuntimeBuildQualitySummary } from "./summarizeSolarRuntimeBuild";
import { getEffectivePanelVisualShading } from "../viewer/visualShading/effectivePanelVisualShading";

type BuildResult = ReturnType<typeof buildSolarScene3DFromCalpinageRuntime>;

export type Fixture3DReadinessSummary = SolarRuntimeBuildQualitySummary & {
  readonly fixtureId: string;
  /** Au moins un panneau avec shading exploitable (runtime ou snapshot). */
  readonly hasVisualShadingData: boolean;
  readonly visualShadingAvailablePanelCount: number;
  readonly visualShadingMissingPanelCount: number;
  readonly coherenceIssueCount: number;
  readonly coherenceWarningCount: number;
  /** Entités cliquables en inspection (pans + PV + volumes). */
  readonly inspectableEntityCount: number;
};

export function summarizeFixture3DReadiness(fixtureId: string, res: BuildResult): Fixture3DReadinessSummary {
  const base = summarizeSolarRuntimeBuild(fixtureId, res);
  const scene = res.scene;
  let visualAvailable = 0;
  let visualMissing = 0;
  if (scene) {
    for (const p of scene.pvPanels) {
      const v = getEffectivePanelVisualShading(String(p.id), scene);
      if (v.state === "AVAILABLE") visualAvailable++;
      else visualMissing++;
    }
  }
  const issues = scene?.coherence?.issues ?? [];
  const inspectableEntityCount =
    (scene?.roofModel.roofPlanePatches.length ?? 0) +
    (scene?.pvPanels.length ?? 0) +
    (scene?.obstacleVolumes.length ?? 0) +
    (scene?.extensionVolumes.length ?? 0);

  return {
    ...base,
    fixtureId,
    hasVisualShadingData: visualAvailable > 0,
    visualShadingAvailablePanelCount: visualAvailable,
    visualShadingMissingPanelCount: visualMissing,
    coherenceIssueCount: issues.length,
    coherenceWarningCount: issues.filter((i) => i.severity === "WARNING").length,
    inspectableEntityCount,
  };
}
