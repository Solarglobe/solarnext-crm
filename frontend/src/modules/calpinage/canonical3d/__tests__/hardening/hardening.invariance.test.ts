/**
 * Invariances géométriques : échelle, translation, rotation Z (couche canonique near shading 3D).
 */
import { describe, expect, it } from "vitest";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import {
  buildZenithOcclusionScene,
  buildZenithOcclusionSceneRotated,
  SUN_ZENITH,
} from "./hardeningSceneFactories";
import { assertAnnualAggregateInvariants, assertTimestepRatios } from "./nearShadingInvariantAsserts";
import golden from "./goldenReferences.json";

const EPS_FRAC = 1e-5;

describe("hardening — invariance géométrique", () => {
  it("échelle ×0.5 / ×1 / ×2 → même fraction ombrée (zénith + obstacle central)", () => {
    const scales = [0.5, 1, 2];
    const means = scales.map((s) => {
      const scene = buildZenithOcclusionScene(s);
      const series = runNearShadingSeries(scene, [SUN_ZENITH]);
      assertAnnualAggregateInvariants(series.annual);
      assertTimestepRatios(series.annual.timestepResults[0]!);
      return series.annual.meanShadedFraction;
    });
    const [a, b, c] = means;
    expect(Math.abs(a - b)).toBeLessThan(EPS_FRAC);
    expect(Math.abs(b - c)).toBeLessThan(EPS_FRAC);
    expect(means[0]!).toBeGreaterThanOrEqual(golden.scenes.zenithOcclusion.meanShadedFractionMin);
    expect(means[0]!).toBeLessThanOrEqual(golden.scenes.zenithOcclusion.meanShadedFractionMax);
  });

  it("translation monde : même fraction quelle que soit l’offset (tolérance numérique)", () => {
    const base = runNearShadingSeries(buildZenithOcclusionScene(1), [SUN_ZENITH]).annual
      .meanShadedFraction;
    const offsets = [
      { x: 500, y: -300, z: 0 },
      { x: -50, y: 120, z: 0 },
    ];
    for (const t of offsets) {
      const m = runNearShadingSeries(buildZenithOcclusionScene(1, t), [SUN_ZENITH]).annual
        .meanShadedFraction;
      expect(Math.abs(m - base)).toBeLessThan(EPS_FRAC);
    }
  });

  it("rotation Z autour de l’origine : fraction identique avec soleil zénith (symétrie)", () => {
    const ref = runNearShadingSeries(buildZenithOcclusionScene(1), [SUN_ZENITH]).annual.meanShadedFraction;
    const angles = [Math.PI / 7, Math.PI / 3];
    for (const rad of angles) {
      const m = runNearShadingSeries(buildZenithOcclusionSceneRotated(1, rad), [SUN_ZENITH]).annual
        .meanShadedFraction;
      expect(Math.abs(m - ref)).toBeLessThan(EPS_FRAC);
    }
  });
});
