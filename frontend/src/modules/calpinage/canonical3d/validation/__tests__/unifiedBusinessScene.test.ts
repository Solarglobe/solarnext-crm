/**
 * Prompt 33 — scène métier unique : mêmes ids / relations trace ↔ SolarScene3D.
 */

import { describe, it, expect } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "../../dev/minimalCalpinageRuntimeFixture";
import { deriveUnifiedRoofSceneReadModel } from "../../scene/unifiedRoofSceneContract";
import { validate2DTo3DCoherence } from "../validate2DTo3DCoherence";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import { createEmptyRoofModel3D } from "../../utils/factories";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { Scene2DSourceTrace } from "../../types/scene2d3dCoherence";

const worldOk: CanonicalWorldConfig = {
  metersPerPixel: 0.02,
  northAngleDeg: 12,
  referenceFrame: "LOCAL_IMAGE_ENU",
};

function sceneSimpleValide(): SolarScene3D {
  const patch = makeHorizontalSquarePatch("pan-a", 20, 10);
  const roofModel = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
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
    { roofPlanePatches: [patch] },
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
      ],
    },
    { roofPlanePatches: [patch] },
  );
  const sourceTrace: Scene2DSourceTrace = {
    schemaVersion: "scene-2d-source-trace-v1",
    sourcePanIds: ["pan-a"],
    sourceObstacleIds: ["obs-1"],
    sourcePanelIds: ["pv-1"],
    expectedRoofPlanePatchIds: ["pan-a"],
    metrics: { sourcePanCount: 1, sourceObstacleCount: 1, sourcePanelCount: 1 },
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

describe("Unified business scene (Prompt 33)", () => {
  it("A — Pan : même id métier en trace, patch 3D et vue agrégée", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(res.scene).not.toBeNull();
    const scene = res.scene!;
    const read = deriveUnifiedRoofSceneReadModel(scene);
    expect(read.sourceTrace?.sourcePanIds).toContain("pan-a");
    expect(read.pansById.has("pan-a")).toBe(true);
    expect(read.pansById.get("pan-a")!.id).toBe("pan-a");
  });

  it("B — Obstacle : relatedPlanePatchId pointe vers un pan présent dans la vue unique", () => {
    const scene = sceneSimpleValide();
    const read = deriveUnifiedRoofSceneReadModel(scene);
    const vol = read.obstacleVolumes[0]!;
    expect(vol.relatedPlanePatchIds.map(String)).toContain("pan-a");
    for (const pid of vol.relatedPlanePatchIds) {
      expect(read.pansById.has(String(pid))).toBe(true);
    }
  });

  it("C — Panneau : même id en trace et pvPanels ; roofPlanePatchId = pan support", () => {
    const scene = sceneSimpleValide();
    const read = deriveUnifiedRoofSceneReadModel(scene);
    const panel = read.pvPanels[0]!;
    expect(panel.id).toBe("pv-1");
    expect(read.sourceTrace?.sourcePanelIds).toContain("pv-1");
    expect(String(panel.attachment.roofPlanePatchId)).toBe("pan-a");
    expect(read.pansById.has("pan-a")).toBe(true);
  });

  it("D — Scène simple : familles attendues (pans, volumes, panneaux, trace)", () => {
    const scene = sceneSimpleValide();
    expect(scene.roofModel.roofPlanePatches.length).toBeGreaterThan(0);
    expect(scene.obstacleVolumes.length).toBeGreaterThan(0);
    expect(scene.pvPanels.length).toBeGreaterThan(0);
    expect(scene.sourceTrace?.sourcePanIds.length).toBeGreaterThan(0);
    const r = validate2DTo3DCoherence(scene);
    expect(r.issues.some((i) => i.code.startsWith("UNIFIED_SCENE_"))).toBe(false);
  });

  it("Diagnostic UNIFIED_SCENE_PANEL_ID_NOT_IN_SOURCE_TRACE si panneau 3D hors inventaire trace", () => {
    const scene = sceneSimpleValide();
    const p0 = scene.pvPanels[0]!;
    const intrus = { ...p0, id: "pv-intrus" };
    const broken: SolarScene3D = { ...scene, pvPanels: [p0, intrus] };
    const r = validate2DTo3DCoherence(broken);
    expect(r.issues.some((i) => i.code === "UNIFIED_SCENE_PANEL_ID_NOT_IN_SOURCE_TRACE")).toBe(true);
  });
});
