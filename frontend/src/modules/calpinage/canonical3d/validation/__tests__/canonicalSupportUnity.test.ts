/**
 * Alignement support unique : toiture / panneaux / obstacles / extensions (Prompt 26).
 * Vérifie qu’une scène assemblée avec un seul tableau `roofPlanePatches` reste cohérente.
 */

import { describe, expect, it } from "vitest";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../../utils/factories";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { Scene2DSourceTrace } from "../../types/scene2d3dCoherence";
import { validate2DTo3DCoherence } from "../validate2DTo3DCoherence";

const worldOk: CanonicalWorldConfig = {
  metersPerPixel: 0.02,
  northAngleDeg: 12,
  referenceFrame: "LOCAL_IMAGE_ENU",
};

/** Toit + panneau + obstacle + extension : un seul `roofPlanePatches` pour volumes et PV. */
function sceneRoofPanelsObstacleExtension(): SolarScene3D {
  const patch = makeHorizontalSquarePatch("pan-a", 20, 10);
  const roofModel = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
  const z0 = 10;
  const footprint = [
    { x: 2, y: 2, z: z0 },
    { x: 4, y: 2, z: z0 },
    { x: 4, y: 4, z: z0 },
    { x: 2, y: 4, z: z0 },
  ];
  const volRes = buildRoofVolumes3D(
    {
      obstacles: [
        {
          id: "obs-1",
          kind: "chimney",
          structuralRole: "obstacle_simple",
          heightM: 1.5,
          footprint: { mode: "world", footprintWorld: footprint },
          relatedPlanePatchIds: ["pan-a"],
        },
      ],
      extensions: [
        {
          id: "ext-1",
          kind: "dormer",
          heightM: 1.2,
          footprint: {
            mode: "world",
            footprintWorld: [
              { x: 8, y: 8, z: z0 },
              { x: 10, y: 8, z: z0 },
              { x: 10, y: 10, z: z0 },
              { x: 8, y: 10, z: z0 },
            ],
          },
          relatedPlanePatchIds: ["pan-a"],
        },
      ],
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

describe("canonicalSupportUnity (Prompt 26)", () => {
  it("A — panneau : panId et patch attendus, pas de divergence support", () => {
    const scene = sceneRoofPanelsObstacleExtension();
    const panel = scene.pvPanels[0]!;
    expect(panel.attachment.roofPlanePatchId).toBe("pan-a");
    const patchIds = new Set(scene.roofModel.roofPlanePatches.map((p) => String(p.id)));
    expect(patchIds.has(String(panel.attachment.roofPlanePatchId))).toBe(true);
    const r = validate2DTo3DCoherence(scene);
    expect(r.issues.some((i) => i.code === "PANEL_PARENT_PAN_UNRESOLVED")).toBe(false);
    expect(r.issues.some((i) => i.code === "PANEL_PARENT_PATCH_MISMATCH")).toBe(false);
    expect(r.issues.some((i) => i.code === "PANEL_Z_SUPPORT_MISMATCH")).toBe(false);
  });

  it("B — obstacle : relatedPlanePatchIds ⊆ patches scène, primary cohérent", () => {
    const scene = sceneRoofPanelsObstacleExtension();
    const obs = scene.obstacleVolumes[0]!;
    expect(obs.relatedPlanePatchIds.map(String)).toEqual(["pan-a"]);
    const r = validate2DTo3DCoherence(scene);
    expect(r.issues.some((i) => i.code === "OBSTACLE_PARENT_PATCH_MISMATCH")).toBe(false);
    expect(r.issues.some((i) => i.code === "OBSTACLE_SUPPORT_GEOMETRY_DIVERGENCE")).toBe(false);
  });

  it("C — extension : même logique de patch parent que la toiture affichée", () => {
    const scene = sceneRoofPanelsObstacleExtension();
    const ext = scene.extensionVolumes[0]!;
    expect(ext.relatedPlanePatchIds.map(String)).toEqual(["pan-a"]);
    const r = validate2DTo3DCoherence(scene);
    expect(r.issues.some((i) => i.code === "ROOF_EXTENSION_PARENT_PATCH_MISMATCH")).toBe(false);
    expect(r.issues.some((i) => i.code === "ROOF_EXTENSION_SUPPORT_DIVERGENCE")).toBe(false);
  });

  it("D — pipeline minimal : toit + panneau + obstacle + extension sans divergence support", () => {
    const scene = sceneRoofPanelsObstacleExtension();
    const r = validate2DTo3DCoherence(scene);
    expect(r.isCoherent).toBe(true);
    expect(r.issues.some((i) => i.code === "MULTIPLE_PAN_TRUTH_DETECTED")).toBe(false);
    expect(r.issues.some((i) => i.code === "CANONICAL_SUPPORT_REFERENCE_MISMATCH")).toBe(false);
  });
});
