/**
 * Cohérence physique minimale : obstacle au-dessus / hors rayon / sous plan.
 */
import { describe, expect, it } from "vitest";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import {
  buildEastSunObstacleWestScene,
  buildEastSunSceneWithObstacleSouth,
  buildObstacleBelowPlaneScene,
  buildZenithOcclusionScene,
  SUN_EAST,
  SUN_ZENITH,
} from "./hardeningSceneFactories";
import { assertAnnualAggregateInvariants, assertTimestepRatios } from "./nearShadingInvariantAsserts";
import golden from "./goldenReferences.json";

describe("hardening — physique near shading 3D", () => {
  it("obstacle au-dessus du pan (zénith) → ombre non nulle", () => {
    const series = runNearShadingSeries(buildZenithOcclusionScene(1), [SUN_ZENITH]);
    assertAnnualAggregateInvariants(series.annual);
    assertTimestepRatios(series.annual.timestepResults[0]!);
    expect(series.annual.meanShadedFraction).toBeGreaterThanOrEqual(
      golden.scenes.zenithOcclusion.meanShadedFractionMin
    );
  });

  it("soleil vers +X, obstacle « derrière » (ouest) → pas d’ombre", () => {
    const series = runNearShadingSeries(buildEastSunObstacleWestScene(1), [SUN_EAST]);
    expect(series.annual.meanShadedFraction).toBeLessThanOrEqual(
      golden.scenes.eastSunObstacleWest.meanShadedFractionMax
    );
  });

  it("soleil vers +X, obstacle au sud (hors tube de rayon) → pas d’ombre", () => {
    const series = runNearShadingSeries(buildEastSunSceneWithObstacleSouth(1), [SUN_EAST]);
    expect(series.annual.meanShadedFraction).toBeLessThanOrEqual(
      golden.scenes.eastSunObstacleSouth.meanShadedFractionMax
    );
  });

  it("empreinte sous le plan du pan (zénith) → pas d’ombre depuis le toit", () => {
    const series = runNearShadingSeries(buildObstacleBelowPlaneScene(1), [SUN_ZENITH]);
    expect(series.annual.meanShadedFraction).toBeLessThanOrEqual(1e-6);
  });
});
