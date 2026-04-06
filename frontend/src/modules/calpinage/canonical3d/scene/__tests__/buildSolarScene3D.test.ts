import { describe, expect, it } from "vitest";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../../utils/factories";
import { SOLAR_SCENE_3D_SCHEMA_VERSION } from "../../types/solarScene3d";
import { buildSolarScene3D } from "../buildSolarScene3D";
import { parseSolarScene3DJson, serializeSolarScene3DStableSorted } from "../exportSolarScene3d";
import { buildClearZenithScene, makeHorizontalSquarePatch, SUN_ZENITH } from "../../__tests__/hardening/hardeningSceneFactories";

function roofModelOneHorizontalPatch() {
  const base = createEmptyRoofModel3D();
  const patch = makeHorizontalSquarePatch("patch-min", 10, 5);
  return { ...base, roofPlanePatches: [patch] };
}

describe("buildSolarScene3D / export", () => {
  it("assemble une scène minimale sans duplication", () => {
    const scene = buildSolarScene3D({
      roofModel: roofModelOneHorizontalPatch(),
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: [],
    });
    expect(scene.metadata.schemaVersion).toBe(SOLAR_SCENE_3D_SCHEMA_VERSION);
    expect(scene.roofModel.roofPlanePatches).toHaveLength(1);
    expect(scene.pvPanels).toHaveLength(0);
    expect(scene.coherence).toBeDefined();
    expect(scene.coherence?.isCoherent).toBe(true);
  });

  it("attache un instantané near shading + contexte solaire", () => {
    const near = runNearShadingSeries(buildClearZenithScene(1), [SUN_ZENITH]);
    const scene = buildSolarScene3D({
      roofModel: roofModelOneHorizontalPatch(),
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: [],
      solarDirections: [SUN_ZENITH],
      solarSamplingKind: "single",
      nearShadingSeries: near,
    });
    expect(scene.solarContext?.directionsTowardSunUnit).toHaveLength(1);
    expect(scene.nearShadingSnapshot?.seriesResult).toBe(near);
    expect(scene.nearShadingSnapshot?.engineId).toBe("canonical_near_raycast_v1");
  });

  it("JSON stable parse / roundtrip", () => {
    const scene = buildSolarScene3D({
      roofModel: roofModelOneHorizontalPatch(),
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: [],
      studyRef: "test-study",
    });
    const json = serializeSolarScene3DStableSorted(scene);
    const parsed = parseSolarScene3DJson(json);
    expect(parsed && typeof parsed === "object" && (parsed as { metadata: { schemaVersion: string } }).metadata.schemaVersion).toBe(
      SOLAR_SCENE_3D_SCHEMA_VERSION
    );
  });
});
