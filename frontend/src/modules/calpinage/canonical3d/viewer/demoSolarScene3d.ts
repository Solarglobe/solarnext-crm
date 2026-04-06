/**
 * Scène de démonstration viewer — même chaîne géométrique que les tests hardening (zénith + obstacle).
 */

import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../utils/factories";
import { buildSolarScene3D } from "../scene/buildSolarScene3D";
import { runNearShadingSeries } from "../nearShading3d/nearShadingEngine";
import {
  buildZenithOcclusionScene,
  makeHorizontalSquarePatch,
  SUN_ZENITH,
} from "../__tests__/hardening/hardeningSceneFactories";
import type { RoofModel3D } from "../types/model";
import type { SolarScene3D } from "../types/solarScene3d";

/**
 * Assemble une SolarScene3D déterministe pour debug / preuve visuelle (noyau canonical3d uniquement).
 */
export function buildDemoSolarScene3D(): SolarScene3D {
  const nearScene = buildZenithOcclusionScene(1);
  const series = runNearShadingSeries(
    {
      panels: nearScene.panels,
      obstacleVolumes: nearScene.obstacleVolumes,
      extensionVolumes: nearScene.extensionVolumes,
      params: nearScene.params,
    },
    [SUN_ZENITH]
  );

  const patch = makeHorizontalSquarePatch("roof-h", 20, 10);
  const base = createEmptyRoofModel3D();
  const roofModel: RoofModel3D = {
    ...base,
    roofPlanePatches: [patch],
    metadata: {
      ...base.metadata,
      reconstructionSource: "from_solver",
    },
  };

  return buildSolarScene3D({
    roofModel,
    obstacleVolumes: nearScene.obstacleVolumes,
    extensionVolumes: nearScene.extensionVolumes,
    volumesQuality: createDefaultQualityBlock(),
    pvPanels: nearScene.panels,
    solarDirections: [SUN_ZENITH],
    solarSamplingKind: "single",
    solarDescription: "Démo zénith — scène hardening zenith occlusion",
    nearShadingSeries: series,
    studyRef: "demo-solar-scene-3d",
    integrationNotes: "Viewer métier SolarScene3D",
    generator: "manual",
  });
}
