/**
 * Garde-fous perf : pas de blow-up évident sur grille modérée.
 */
import { describe, expect, it } from "vitest";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../../nearShading3d/nearShadingParams";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import { makeHorizontalSquarePatch, SUN_ZENITH } from "./hardeningSceneFactories";

const MAX_MS = 8000;
const N_PANELS = 24;
const N_DIRECTIONS = 12;

describe("hardening — performance (smoke)", () => {
  it(`N=${N_PANELS} panneaux × M=${N_DIRECTIONS} directions reste sous ${MAX_MS} ms`, () => {
    const patch = makeHorizontalSquarePatch("perf-roof", 80, 10);
    const panelSpecs = Array.from({ length: N_PANELS }, (_, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      return {
        id: `pv-${i}`,
        roofPlanePatchId: patch.id,
        center: { mode: "plane_uv" as const, uv: { u: 8 + col * 12, v: 8 + row * 10 } },
        widthM: 1,
        heightM: 1.5,
        orientation: "portrait" as const,
        rotationDegInPlane: 0,
        sampling: { nx: 2, ny: 2 },
      };
    });
    const { panels } = buildPvPanels3D({ panels: panelSpecs }, { roofPlanePatches: [patch] });
    const dirs = Array.from({ length: N_DIRECTIONS }, (_, i) => {
      const a = (i / N_DIRECTIONS) * Math.PI * 2;
      return {
        directionTowardSunWorld: {
          x: Math.cos(a) * 0.3,
          y: Math.sin(a) * 0.3,
          z: Math.sqrt(1 - 0.18),
        },
      };
    });
    const t0 = performance.now();
    const series = runNearShadingSeries(
      {
        panels,
        obstacleVolumes: [],
        extensionVolumes: [],
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      dirs
    );
    const dt = performance.now() - t0;
    expect(series.annual.meanShadedFraction).toBeGreaterThanOrEqual(0);
    expect(dt).toBeLessThan(MAX_MS);
  });
});
