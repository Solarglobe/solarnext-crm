import { describe, expect, it } from "vitest";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../nearShadingParams";
import { runNearShadingSeries, runNearShadingTimeStep } from "../nearShadingEngine";

function makeSquarePatch(id: string): RoofPlanePatch3D {
  const normal = { x: 0, y: 0, z: 1 };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["v1", "v2", "v3", "v4"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld: [
      { x: 0, y: 0, z: 10 },
      { x: 20, y: 0, z: 10 },
      { x: 20, y: 20, z: 10 },
      { x: 0, y: 20, z: 10 },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 10 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: -10 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 10, y: 10, z: 10 },
    surface: { areaM2: 400 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:patch" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

function makeSceneWithPanel(patch: RoofPlanePatch3D, obstacleOnly: boolean) {
  const { panels } = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-1",
          roofPlanePatchId: patch.id,
          center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
          widthM: 1,
          heightM: 1.5,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2 },
        },
      ],
    },
    { roofPlanePatches: [patch] }
  );

  const vols = obstacleOnly
    ? { obstacles: [], extensions: [] }
    : buildRoofVolumes3D({
        obstacles: [
          {
            id: "obs-block",
            kind: "chimney",
            structuralRole: "obstacle_structuring",
            heightM: 2,
            footprint: {
              mode: "world",
              footprintWorld: [
                { x: 8, y: 8, z: 10 },
                { x: 12, y: 8, z: 10 },
                { x: 12, y: 12, z: 10 },
                { x: 8, y: 12, z: 10 },
              ],
            },
            relatedPlanePatchIds: [patch.id],
          },
        ],
        extensions: [],
      });

  return {
    panels,
    obstacleVolumes: obstacleOnly ? [] : vols.obstacleVolumes,
    extensionVolumes: obstacleOnly ? [] : vols.extensionVolumes,
  };
}

describe("nearShading3d", () => {
  it("sans obstacle : aucun échantillon ombré vers le zénith", () => {
    const patch = makeSquarePatch("p1");
    const { panels, obstacleVolumes, extensionVolumes } = makeSceneWithPanel(patch, true);
    const step = runNearShadingTimeStep(
      {
        panels,
        obstacleVolumes,
        extensionVolumes,
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      { directionTowardSunWorld: { x: 0, y: 0, z: 1 } }
    );
    expect(step.shadedSamples).toBe(0);
    expect(step.globalShadedFraction).toBe(0);
    expect(step.panelResults[0].shadingRatio).toBe(0);
  });

  it("avec obstacle volumique : au moins un échantillon ombré (rayon +Z)", () => {
    const patch = makeSquarePatch("p2");
    const { panels, obstacleVolumes, extensionVolumes } = makeSceneWithPanel(patch, false);
    const step = runNearShadingTimeStep(
      {
        panels,
        obstacleVolumes,
        extensionVolumes,
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      { directionTowardSunWorld: { x: 0, y: 0, z: 1 } }
    );
    expect(obstacleVolumes.length).toBeGreaterThan(0);
    expect(step.shadedSamples).toBeGreaterThan(0);
    expect(step.globalShadedFraction).toBeGreaterThan(0);
    const hit = step.panelResults[0].sampleResults.find((s) => s.shaded);
    expect(hit?.hitVolumeId).toBe("obs-block");
    expect(hit?.hitFaceId).toBeTruthy();
  });

  it("direction solaire invalide : diagnostic", () => {
    const patch = makeSquarePatch("p3");
    const { panels, obstacleVolumes, extensionVolumes } = makeSceneWithPanel(patch, true);
    const step = runNearShadingTimeStep(
      {
        panels,
        obstacleVolumes,
        extensionVolumes,
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      { directionTowardSunWorld: { x: 0, y: 0, z: 0 } }
    );
    expect(step.quality.diagnostics.some((d) => d.code === "NS_INVALID_SUN_DIRECTION")).toBe(true);
    expect(step.totalSamples).toBe(0);
  });

  it("deux panneaux : agrégation globale sur tous les échantillons", () => {
    const patch = makeSquarePatch("p5");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "a",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 5, v: 5 } },
            widthM: 0.5,
            heightM: 0.5,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
          {
            id: "b",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 15, v: 15 } },
            widthM: 0.5,
            heightM: 0.5,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const step = runNearShadingTimeStep(
      {
        panels,
        obstacleVolumes: [],
        extensionVolumes: [],
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      { directionTowardSunWorld: { x: 0, y: 0, z: 1 } }
    );
    expect(step.panelResults).toHaveLength(2);
    expect(step.totalSamples).toBe(2);
    expect(step.shadedSamples).toBe(0);
  });

  it("série multi-directions : agrégat annuel cohérent", () => {
    const patch = makeSquarePatch("p4");
    const { panels, obstacleVolumes, extensionVolumes } = makeSceneWithPanel(patch, true);
    const scene = {
      panels,
      obstacleVolumes,
      extensionVolumes,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    const series = runNearShadingSeries(scene, [
      { directionTowardSunWorld: { x: 0, y: 0, z: 1 } },
      { directionTowardSunWorld: { x: 0, y: 0, z: 1 } },
    ]);
    expect(series.annual.timestepResults).toHaveLength(2);
    expect(series.annual.meanShadedFraction).toBe(0);
    expect(series.annual.nearShadingLossProxy).toBe(1);
  });
});
