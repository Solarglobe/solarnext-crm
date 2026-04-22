/**
 * Données limites : pas de crash, diagnostics / agrégats cohérents.
 */
import { describe, expect, it } from "vitest";
import { runNearShadingSeries, runNearShadingTimeStep } from "../../nearShading3d/nearShadingEngine";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../../nearShading3d/nearShadingParams";
import { buildClearZenithScene, buildZenithOcclusionScene, SUN_ZENITH } from "./hardeningSceneFactories";
import { assertAnnualAggregateInvariants } from "./nearShadingInvariantAsserts";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import { runCanonicalNearShadingPipeline } from "../../../integration/runCanonicalNearShadingPipeline";
import type { LegacyRoofGeometryInput } from "../../builder/legacyInput";
import type { ObstacleInput, PanelInput } from "../../../shading/shadingInputTypes";

describe("hardening — robustesse", () => {
  it("scène sans panneaux : agrégat nul, pas de throw", () => {
    const series = runNearShadingSeries(
      {
        panels: [],
        obstacleVolumes: [],
        extensionVolumes: [],
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      [SUN_ZENITH]
    );
    expect(series.annual.meanShadedFraction).toBe(0);
    expect(series.annual.timestepResults[0]!.totalSamples).toBe(0);
  });

  it("direction soleil nulle : diagnostic NS_INVALID_SUN_DIRECTION", () => {
    const scene = buildClearZenithScene(1);
    const step = runNearShadingTimeStep(scene, {
      directionTowardSunWorld: { x: 0, y: 0, z: 0 },
    });
    expect(step.quality.diagnostics.some((d) => d.code === "NS_INVALID_SUN_DIRECTION")).toBe(true);
    expect(step.totalSamples).toBe(0);
  });

  it("NaN dans direction solaire : pas de throw, direction rejetée (normalize3)", () => {
    const scene = buildClearZenithScene(1);
    const step = runNearShadingTimeStep(scene, {
      directionTowardSunWorld: { x: NaN, y: 0, z: 1 },
    });
    expect(step.totalSamples).toBe(0);
    expect(step.quality.diagnostics.some((d) => d.code === "NS_INVALID_SUN_DIRECTION")).toBe(true);
  });

  it("pipeline canonical : entrée toiture invalide (mpp négatif) → ok false", () => {
    const legacyRoof: LegacyRoofGeometryInput = {
      metersPerPixel: -1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [
        {
          id: "x",
          polygonPx: [
            { xPx: 0, yPx: 0 },
            { xPx: 10, yPx: 0 },
            { xPx: 0, yPx: 10 },
          ],
        },
      ],
    };
    const panels: PanelInput[] = [
      {
        id: "p1",
        panId: "x",
        polygonPx: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ];
    const obstacles: ObstacleInput[] = [];
    const officialRoofModelResult = buildRoofModel3DFromLegacyGeometry(legacyRoof);
    const r = runCanonicalNearShadingPipeline({
      officialRoofModelResult,
      obstacles,
      panels,
      metersPerPixel: 1,
      northAngleDeg: 0,
      sunVectors: [{ dx: 0, dy: 0, dz: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/NO_ROOF|PATCH/i);
    }
  });

  it("scène valide zénith : invariants annuels", () => {
    const series = runNearShadingSeries(buildZenithOcclusionScene(1), [SUN_ZENITH]);
    assertAnnualAggregateInvariants(series.annual);
  });
});
