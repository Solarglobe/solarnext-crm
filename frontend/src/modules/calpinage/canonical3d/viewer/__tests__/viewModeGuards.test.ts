import { describe, it, expect } from "vitest";
import { diagnoseViewModeSwitch } from "../viewModeGuards";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { createEmptyRoofModel3D } from "../../utils/factories";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";

describe("diagnoseViewModeSwitch (Prompt 34)", () => {
  it("VIEW_MODE_CAMERA_INVALID si mode inconnu", () => {
    const d = diagnoseViewModeSwitch({
      sceneBefore: null,
      sceneAfter: null,
      modeBefore: "SCENE_3D",
      modeAfter: "SCENE_3D",
    });
    expect(d.length).toBe(0);
    const bad = diagnoseViewModeSwitch({
      sceneBefore: null,
      sceneAfter: null,
      modeBefore: "SCENE_3D",
      modeAfter: "FAKE" as unknown as import("../cameraViewMode").CameraViewMode,
    });
    expect(bad.some((x) => x.code === "VIEW_MODE_CAMERA_INVALID")).toBe(true);
  });

  it("VIEW_MODE_SCENE_MISMATCH si la scène change alors que seul le mode devait changer", () => {
    const patch = makeHorizontalSquarePatch("p", 5, 0);
    const roof = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
    const a = buildSolarScene3D({
      worldConfig: { metersPerPixel: 0.02, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
      roofModel: roof,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: roof.globalQuality,
      pvPanels: [],
    });
    const b = buildSolarScene3D({
      worldConfig: { metersPerPixel: 0.02, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
      roofModel: roof,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: roof.globalQuality,
      pvPanels: [],
    });
    const d = diagnoseViewModeSwitch({
      sceneBefore: a,
      sceneAfter: b,
      modeBefore: "SCENE_3D",
      modeAfter: "PLAN_2D",
      onlyViewModeChanged: true,
    });
    expect(d.some((x) => x.code === "VIEW_MODE_SCENE_MISMATCH")).toBe(true);
  });

  it("pas d’erreur si même référence de scène et changement de mode", () => {
    const patch = makeHorizontalSquarePatch("p", 5, 0);
    const roof = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
    const scene = buildSolarScene3D({
      worldConfig: { metersPerPixel: 0.02, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
      roofModel: roof,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: roof.globalQuality,
      pvPanels: [],
    });
    const d = diagnoseViewModeSwitch({
      sceneBefore: scene,
      sceneAfter: scene,
      modeBefore: "SCENE_3D",
      modeAfter: "PLAN_2D",
      onlyViewModeChanged: true,
    });
    expect(d.filter((x) => x.code === "VIEW_MODE_SCENE_MISMATCH")).toHaveLength(0);
  });
});
