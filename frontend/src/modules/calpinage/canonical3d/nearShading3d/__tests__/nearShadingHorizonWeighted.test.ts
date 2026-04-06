import { describe, expect, it } from "vitest";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../nearShadingParams";
import { runNearShadingSeriesHorizonWeighted } from "../nearShadingHorizonWeighted";

function flatPatch(id: string): RoofPlanePatch3D {
  const normal = { x: 0, y: 0, z: 1 };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["v1", "v2", "v3", "v4"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld: [
      { x: 0, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
      { x: 20, y: 20, z: 0 },
      { x: 0, y: 20, z: 0 },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: 0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 10, y: 10, z: 0 },
    surface: { areaM2: 400 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

describe("runNearShadingSeriesHorizonWeighted", () => {
  it("sans masque : exécute le pas zénith et agrège per-panel", () => {
    const patch = flatPatch("pan-a");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-1",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 2, ny: 2 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const scene = {
      panels,
      obstacleVolumes: [] as const,
      extensionVolumes: [] as const,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    const r = runNearShadingSeriesHorizonWeighted(scene, [{ dx: 0, dy: 0, dz: 1 }], null);
    expect(r.annual.timestepResults.length).toBe(1);
    expect(r.perPanelMeanShadedFraction.get("pv-1")).toBe(0);
  });

  it("masque bloque tout : aucun pas, moyenne 0", () => {
    const patch = flatPatch("pan-b");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-2",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const scene = {
      panels,
      obstacleVolumes: [] as const,
      extensionVolumes: [] as const,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    const maskBins = Array.from({ length: 36 }, (_, i) => ({ az: i * 10, elev: 50 }));
    const mask = { mask: maskBins };
    const r = runNearShadingSeriesHorizonWeighted(
      scene,
      [{ dx: 0.86602540378, dy: 0, dz: 0.5 }],
      mask
    );
    expect(r.annual.timestepResults.length).toBe(0);
    expect(r.annual.meanShadedFraction).toBe(0);
  });
});
