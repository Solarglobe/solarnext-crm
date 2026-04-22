import { describe, it, expect } from "vitest";
import { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "../../../builder/worldMapping";
import { makeHorizontalSquarePatch } from "../../../__tests__/hardening/hardeningSceneFactories";
import { buildSolarScene3D } from "../../../scene/buildSolarScene3D";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../../../utils/factories";
import { buildPickProvenance2DViewModel } from "../buildPickProvenance2DViewModel";

const worldConfig = {
  metersPerPixel: 0.05,
  northAngleDeg: 12,
  referenceFrame: "LOCAL_IMAGE_ENU" as const,
};

function sceneWithPan(patchId: string) {
  const base = createEmptyRoofModel3D();
  const roofModel = { ...base, roofPlanePatches: [makeHorizontalSquarePatch(patchId, 10, 5)] };
  return buildSolarScene3D({
    worldConfig,
    roofModel,
    obstacleVolumes: [],
    extensionVolumes: [],
    volumesQuality: createDefaultQualityBlock(),
    pvPanels: [],
    sourceTrace: {
      schemaVersion: "scene-2d-source-trace-v1",
      sourcePanIds: [patchId],
      sourceObstacleIds: [],
      sourcePanelIds: [],
    },
  });
}

describe("buildPickProvenance2DViewModel", () => {
  it("expose patchId, sourceTrace, lien pans[i] et projection px (worldConfig)", () => {
    const scene = sceneWithPan("roof-test");
    const patch = scene.roofModel.roofPlanePatches[0]!;
    const poly = patch.cornersWorld.map((c) => {
      const p = worldHorizontalMToImagePx(c.x, c.y, worldConfig.metersPerPixel, worldConfig.northAngleDeg);
      return { x: p.xPx, y: p.yPx };
    });
    const vm = buildPickProvenance2DViewModel({
      scene,
      roofPlanePatchId: "roof-test",
      highlightVertexIndex: 0,
      calpinagePans: [{ id: "roof-test", polygonPx: poly }],
      imageSizePx: { width: 2000, height: 1500 },
    });
    expect(vm).not.toBeNull();
    expect(vm!.rows.some((r) => r.label === "roofPlanePatchId" && r.value === "roof-test")).toBe(true);
    expect(vm!.rows.some((r) => r.value.includes("pans[0]") && r.value.includes("roof-test"))).toBe(true);
    expect(vm!.rows.some((r) => r.label.includes("sourceTrace.sourcePanIds"))).toBe(true);
    const c0 = patch.cornersWorld[0]!;
    const w = imagePxToWorldHorizontalM(poly[0]!.x, poly[0]!.y, worldConfig.metersPerPixel, worldConfig.northAngleDeg);
    expect(w.x).toBeCloseTo(c0.x, 5);
    expect(w.y).toBeCloseTo(c0.y, 5);
    expect(vm!.rows.some((r) => r.label.includes("écart"))).toBe(true);
  });

  it("sans worldConfig valide : avertissement et pas de projection", () => {
    const scene = sceneWithPan("only-patch");
    const sceneNoWc = { ...scene, worldConfig: undefined };
    const vm = buildPickProvenance2DViewModel({
      scene: sceneNoWc,
      roofPlanePatchId: "only-patch",
    });
    expect(vm!.warnings.some((w) => w.includes("worldConfig"))).toBe(true);
    expect(vm!.rows.some((r) => r.label.includes("worldHorizontalMToImagePx"))).toBe(false);
  });
});
