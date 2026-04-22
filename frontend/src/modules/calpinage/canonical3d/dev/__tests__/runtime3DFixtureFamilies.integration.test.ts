/**
 * Familles officielles Prompt 15 : chaîne runtime → adapter → `buildSolarScene3D` (via
 * `buildSolarScene3DFromCalpinageRuntime`) → readiness + inspection (données, pas clic WebGL).
 */

import { describe, it, expect } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntime";
import { buildSceneInspectionViewModel } from "../../viewer/inspection/buildSceneInspectionViewModel";
import {
  RUNTIME_3D_FIXTURE_BATTERY,
  RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS,
  runtimeFixtureWithStrictRootPans,
} from "../runtime3DFixtureBattery";
import { summarizeFixture3DReadiness } from "../summarizeFixture3DReadiness";

function buildWithBatteryPanels(runtime: Record<string, unknown>, panels: unknown[]) {
  return buildSolarScene3DFromCalpinageRuntime(runtimeFixtureWithStrictRootPans(runtime), {
    getAllPanels: () => panels,
  });
}

function assertPanelsAttachedToPatches(scene: NonNullable<ReturnType<typeof buildWithBatteryPanels>["scene"]>) {
  const patchIds = new Set(scene.roofModel.roofPlanePatches.map((p) => String(p.id)));
  for (const pv of scene.pvPanels) {
    expect(
      patchIds.has(String(pv.attachment.roofPlanePatchId)),
      `panneau ${String(pv.id)} sans pan associé dans roofPlanePatches`,
    ).toBe(true);
  }
}

describe("runtime3DFixtureBattery — familles officielles", () => {
  it("les 5 ids officiels sont dans la batterie", () => {
    for (const id of RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS) {
      expect(RUNTIME_3D_FIXTURE_BATTERY[id]).toBeDefined();
    }
  });

  it("simple_gable_clean — référence 2 pans / 4 PV / pas d’obstacle / shading complet", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY.simple_gable_clean!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    expect(res.scene).not.toBeNull();
    const q = summarizeFixture3DReadiness(b.id, res);
    expect(q.roofPlanePatchCount).toBe(2);
    expect(q.pvPanelCount).toBe(4);
    expect(q.obstacleVolumeCount).toBe(0);
    expect(q.hasVisualShadingData).toBe(true);
    expect(q.visualShadingAvailablePanelCount).toBe(4);
    expect(q.visualShadingMissingPanelCount).toBe(0);
    expect(q.inspectableEntityCount).toBe(6);
    assertPanelsAttachedToPatches(res.scene!);
    const panId = res.scene!.roofModel.roofPlanePatches[0]!.id;
    const panVm = buildSceneInspectionViewModel(res.scene!, { kind: "PAN", id: String(panId) });
    expect(panVm.title).not.toMatch(/introuvable/i);
    expect(panVm.rows.length).toBeGreaterThan(0);
    const pvVm = buildSceneInspectionViewModel(res.scene!, {
      kind: "PV_PANEL",
      id: String(res.scene!.pvPanels[0]!.id),
    });
    expect(pvVm.title).not.toMatch(/introuvable/i);
  });

  it("gable_with_chimney — obstacle présent + shading + inspection obstacle", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY.gable_with_chimney!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    const scene = res.scene!;
    const q = summarizeFixture3DReadiness(b.id, res);
    expect(q.roofPlanePatchCount).toBe(2);
    expect(q.pvPanelCount).toBe(4);
    expect(q.obstacleVolumeCount).toBe(1);
    expect(q.hasVisualShadingData).toBe(true);
    expect(q.visualShadingAvailablePanelCount).toBe(4);
    expect(q.inspectableEntityCount).toBe(7);
    assertPanelsAttachedToPatches(scene);
    const vol = scene.obstacleVolumes[0]!;
    const obsVm = buildSceneInspectionViewModel(scene, { kind: "OBSTACLE", id: String(vol.id) });
    expect(obsVm.title).not.toMatch(/introuvable/i);
    expect(obsVm.rows.find((r) => r.label === "Hauteur")).toBeDefined();
  });

  it("multi_pan_complex — 3 pans / dense / pas de shading runtime (fallback neutre)", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY.multi_pan_complex!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    const scene = res.scene!;
    const q = summarizeFixture3DReadiness(b.id, res);
    expect(q.roofPlanePatchCount).toBe(3);
    expect(q.pvPanelCount).toBe(5);
    expect(q.obstacleVolumeCount).toBe(1);
    expect(q.hasVisualShadingData).toBe(false);
    expect(q.visualShadingAvailablePanelCount).toBe(0);
    expect(q.visualShadingMissingPanelCount).toBe(5);
    expect(q.inspectableEntityCount).toBe(9);
    assertPanelsAttachedToPatches(scene);
  });

  it("partial_degraded_like — données imparfaites mais build OK, shading partiel", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY.partial_degraded_like!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    const scene = res.scene!;
    const q = summarizeFixture3DReadiness(b.id, res);
    expect(q.roofPlanePatchCount).toBe(2);
    expect(q.pvPanelCount).toBe(4);
    expect(q.obstacleVolumeCount).toBe(1);
    expect(q.hasVisualShadingData).toBe(true);
    expect(q.visualShadingAvailablePanelCount).toBe(2);
    expect(q.visualShadingMissingPanelCount).toBe(2);
    expect(q.inspectableEntityCount).toBe(7);
    assertPanelsAttachedToPatches(scene);
  });

  it("dense_loaded_case — scène chargée stable (comptages forts)", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY.dense_loaded_case!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    const scene = res.scene!;
    const q = summarizeFixture3DReadiness(b.id, res);
    expect(q.roofPlanePatchCount).toBe(3);
    expect(q.pvPanelCount).toBe(14);
    expect(q.obstacleVolumeCount).toBe(3);
    expect(q.hasVisualShadingData).toBe(true);
    expect(q.visualShadingAvailablePanelCount).toBe(14);
    expect(q.visualShadingMissingPanelCount).toBe(0);
    expect(q.inspectableEntityCount).toBe(20);
    assertPanelsAttachedToPatches(scene);
  });
});
