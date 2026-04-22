/**
 * Chaîne complète runtime → `buildSolarScene3DFromCalpinageRuntime` sur profils toiture crédibles.
 */

import { describe, it, expect } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntime";
import {
  RUNTIME_3D_FIXTURE_BATTERY,
  RUNTIME_3D_FIXTURE_KEYS,
  runtimeFixtureWithStrictRootPans,
} from "../runtime3DFixtureBattery";
import { summarizeSolarRuntimeBuild } from "../summarizeSolarRuntimeBuild";

function buildWithBatteryPanels(runtime: Record<string, unknown>, panels: unknown[]) {
  return buildSolarScene3DFromCalpinageRuntime(runtimeFixtureWithStrictRootPans(runtime), {
    getAllPanels: () => panels,
  });
}

describe("runtime3DFixtureBattery — intégration chaîne canonical", () => {
  it("référence : toutes les clés connues sont dans la map", () => {
    for (const k of RUNTIME_3D_FIXTURE_KEYS) {
      expect(RUNTIME_3D_FIXTURE_BATTERY[k]).toBeDefined();
    }
  });

  it("CAS 1 mono-pan nominal : build OK, scène, cohérence, compteurs attendus", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["mono-pan-nominal"]!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    const q = summarizeSolarRuntimeBuild(b.id, res);

    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(q.worldConfigPresent).toBe(true);
    expect(q.roofPlanePatchCount).toBe(1);
    expect(q.pvPanelCount).toBe(2);
    expect(q.obstacleVolumeCount).toBeGreaterThan(0);
    expect(q.sourceTraceSourcePanCount).toBeGreaterThan(0);
    expect(q.coherenceIsCoherent).toBe(true);
    expect(q.validationErrorCodes.length).toBe(0);
    expect(res.scene!.sourceTrace?.expectedRoofPlanePatchIds?.length).toBeGreaterThan(0);
  });

  it("CAS 2 double pan + ridge : 2 patches, ridge 3D, panneaux sur les deux pans", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["dual-pan-ridge"]!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    const q = summarizeSolarRuntimeBuild(b.id, res);

    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    expect(q.roofPlanePatchCount).toBe(2);
    expect(q.roofRidge3dCount).toBeGreaterThanOrEqual(1);
    expect(q.pvPanelCount).toBe(2);
    expect(q.coherenceIsCoherent).toBe(true);
  });

  it("CAS 3 multi-pans L : scène construite, diagnostics lisibles, pas de crash", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["multi-pan-l-shaped"]!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    const q = summarizeSolarRuntimeBuild(b.id, res);

    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(q.roofPlanePatchCount).toBe(3);
    expect(q.pvPanelCount).toBe(5);
    expect(q.obstacleVolumeCount).toBeGreaterThan(0);
    expect(q.validationStatsPanCount).toBe(3);
    expect(q.validationStatsPanelCount).toBe(5);
    expect(q.validationStatsObstacleCount).toBeGreaterThan(0);
  });

  it("CAS 4 partiel (contrat monde matérialisé au build) : chaîne OK, scène officielle", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["partial-missing-world-contract"]!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    const q = summarizeSolarRuntimeBuild(b.id, res);

    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(q.scenePresent).toBe(true);
    expect(q.validationErrorCodes.length).toBe(0);
    const roof = (b.runtime as Record<string, unknown>).roof as Record<string, unknown>;
    expect(roof.canonical3DWorldContract).toBeDefined();
  });

  it("CAS 5 tendu : chaîne OK, nombreux panneaux, obstacle présent, warnings tolérés", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["tense-small-dual-pan"]!;
    const res = buildWithBatteryPanels(b.runtime, b.panels);
    const q = summarizeSolarRuntimeBuild(b.id, res);

    expect(res.ok, JSON.stringify(res.diagnostics.errors)).toBe(true);
    expect(q.roofPlanePatchCount).toBe(2);
    expect(q.pvPanelCount).toBe(8);
    expect(q.obstacleVolumeCount).toBeGreaterThan(0);
    expect(q.roofRidge3dCount).toBeGreaterThanOrEqual(1);
    expect(res.coherence?.isCoherent ?? true).toBe(true);
  });
});
