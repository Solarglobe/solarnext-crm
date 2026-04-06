/**
 * Référence « golden » — scène multi-pans saine : non-régression sur cohérence, trace, summary et grade.
 */

import { describe, it, expect } from "vitest";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import {
  makeHorizontalSquarePatch,
  translatePatch,
} from "../../__tests__/hardening/hardeningSceneFactories";
import { createEmptyRoofModel3D } from "../../utils/factories";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { Scene2DSourceTrace } from "../../types/scene2d3dCoherence";
import { validate2DTo3DCoherence } from "../validate2DTo3DCoherence";

const worldOk: CanonicalWorldConfig = {
  metersPerPixel: 0.02,
  northAngleDeg: 12,
  referenceFrame: "LOCAL_IMAGE_ENU",
};

/**
 * Deux pans disjoints, un obstacle prismatique, deux panneaux, sourceTrace complète.
 * Toute évolution qui casse ce profil doit être revue explicitement (produit / pipeline).
 */
function buildGoldenHealthyMultiPanScene(): SolarScene3D {
  const panA = makeHorizontalSquarePatch("pan-a", 20, 10);
  const panB = translatePatch(makeHorizontalSquarePatch("pan-b", 20, 10), { x: 22, y: 0, z: 0 });
  const patches = [panA, panB];
  const roofModel = { ...createEmptyRoofModel3D(), roofPlanePatches: patches };

  const volRes = buildRoofVolumes3D(
    {
      obstacles: [
        {
          id: "obs-1",
          kind: "chimney",
          structuralRole: "obstacle_simple",
          heightM: 1.5,
          footprint: {
            mode: "world",
            footprintWorld: [
              { x: 2, y: 2, z: 10 },
              { x: 4, y: 2, z: 10 },
              { x: 4, y: 4, z: 10 },
              { x: 2, y: 4, z: 10 },
            ],
          },
          relatedPlanePatchIds: ["pan-a"],
        },
      ],
      extensions: [],
    },
    { roofPlanePatches: patches },
  );

  const pvRes = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-1",
          roofPlanePatchId: "pan-a",
          center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
          widthM: 1,
          heightM: 1.7,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2, includeEdgeMidpoints: false },
        },
        {
          id: "pv-2",
          roofPlanePatchId: "pan-b",
          center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
          widthM: 1,
          heightM: 1.7,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2, includeEdgeMidpoints: false },
        },
      ],
    },
    { roofPlanePatches: patches },
  );

  const sourceTrace: Scene2DSourceTrace = {
    schemaVersion: "scene-2d-source-trace-v1",
    sourcePanIds: ["pan-a", "pan-b"],
    sourceObstacleIds: ["obs-1"],
    sourcePanelIds: ["pv-1", "pv-2"],
    expectedRoofPlanePatchIds: ["pan-a", "pan-b"],
    metrics: {
      sourcePanCount: 2,
      sourceObstacleCount: 1,
      sourcePanelCount: 2,
    },
  };

  return buildSolarScene3D({
    worldConfig: worldOk,
    sourceTrace,
    roofModel,
    obstacleVolumes: volRes.obstacleVolumes,
    extensionVolumes: volRes.extensionVolumes,
    volumesQuality: volRes.globalQuality,
    pvPanels: pvRes.panels,
  });
}

describe("Golden — cohérence 2D→3D scène saine de référence", () => {
  it("multi-pans + obstacle + panneaux + trace → cohérent, confiance, summary et grade attendus", () => {
    const scene = buildGoldenHealthyMultiPanScene();
    expect(scene.coherence).toBeDefined();
    const c = scene.coherence!;
    expect(c.isCoherent).toBe(true);
    expect(c.confidence.source2DLinked).toBe(true);
    expect(c.summary.hasSourceTrace).toBe(true);
    expect(c.summary.hasBlockingGeometryErrors).toBe(false);
    expect(c.summary.hasRoofSourceCoverageGap).toBe(false);
    expect(c.summary.hasRoofModelPatchDivergence).toBe(false);
    expect(c.summary.hasPanelLayoutGlobalMismatch).toBe(false);
    expect(c.summary.hasMissingSceneEntitiesFromSource).toBe(false);
    expect(c.summary.warningCount).toBe(0);
    expect(c.summary.errorCount).toBe(0);
    expect(c.sceneQualityGrade === "A" || c.sceneQualityGrade === "B").toBe(true);
    expect(c.stats.panCount).toBe(2);
    expect(c.stats.obstacleCount).toBeGreaterThanOrEqual(1);
    expect(c.stats.panelCount).toBeGreaterThanOrEqual(2);
    expect(scene.sourceTrace?.schemaVersion).toBe("scene-2d-source-trace-v1");

    const again = validate2DTo3DCoherence(scene);
    expect(again.isCoherent).toBe(true);
    expect(again.sceneQualityGrade).toBe(c.sceneQualityGrade);
  });
});
