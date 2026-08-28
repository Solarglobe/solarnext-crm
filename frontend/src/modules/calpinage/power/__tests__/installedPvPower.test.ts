import { describe, expect, it } from "vitest";
import type { PvPanelSurface3D } from "../../canonical3d/types/pv-panel-3d";
import {
  computeInstalledPvPower,
  isPvPanelCountableForPower,
  resolvePvModulePowerWc,
  resolveSelectedPvModulePower,
} from "../installedPvPower";

let panelSeq = 0;

function panel(status: "VALID" | "INVALID" = "VALID"): PvPanelSurface3D {
  panelSeq += 1;
  return {
    id: `panel-${status}-${panelSeq}`,
    widthM: 1.13,
    heightM: 1.72,
    placementValidity: {
      status,
      reasons: status === "VALID" ? [] : ["outside_roof_surface"],
      distanceCenterToPlaneM: 0,
      maxCornerDistanceToPlaneM: 0,
    },
  } as unknown as PvPanelSurface3D;
}

describe("installed PV power", () => {
  it("uses the selected catalog module power, not panel surface", () => {
    const selected = resolveSelectedPvModulePower({
      selectedPanelId: "mod-a",
      panelCatalog: [{ id: "mod-a", power_wc: 425 }],
    });
    const summary = computeInstalledPvPower({
      panels: Array.from({ length: 10 }, () => panel()),
      modulePowerWc: selected.unitPowerWc,
    });

    expect(selected.source).toBe("catalog_selected_panel");
    expect(summary.totalPowerWc).toBe(4250);
    expect(summary.totalPowerKwc).toBe(4.25);
  });

  it("recomputes when the selected module changes", () => {
    const panels = Array.from({ length: 12 }, () => panel());

    expect(computeInstalledPvPower({ panels, modulePowerWc: 400 }).totalPowerWc).toBe(4800);
    expect(computeInstalledPvPower({ panels, modulePowerWc: 500 }).totalPowerWc).toBe(6000);
  });

  it("sums per-panel power for mixed modules instead of using the selected module for all panels", () => {
    const panels = [
      ...Array.from({ length: 9 }, () => ({ power_wc: 375 })),
      ...Array.from({ length: 6 }, () => ({ power_wc: 500 })),
    ];

    const summary = computeInstalledPvPower({ panels, modulePowerWc: 500 });

    expect(summary.countablePanelCount).toBe(15);
    expect(summary.totalPowerWc).toBe(6375);
    expect(summary.totalPowerKwc).toBe(6.375);
  });

  it("returns an unavailable state when module power is missing", () => {
    const selected = resolveSelectedPvModulePower({
      selectedPanelId: "mod-empty",
      panelCatalog: [{ id: "mod-empty", width_mm: 1134, height_mm: 1722 }],
    });
    const summary = computeInstalledPvPower({
      panels: [panel(), panel()],
      modulePowerWc: selected.unitPowerWc,
    });

    expect(selected.unitPowerWc).toBeNull();
    expect(summary.totalPowerWc).toBeNull();
    expect(summary.totalPowerKwc).toBeNull();
    expect(summary.unavailableReason).toBe("module_power_missing");
  });

  it("does not count invalid panels", () => {
    const summary = computeInstalledPvPower({
      panels: [panel("VALID"), panel("INVALID"), panel("VALID")],
      modulePowerWc: 485,
    });

    expect(summary.countablePanelCount).toBe(2);
    expect(summary.ignoredPanelCount).toBe(1);
    expect(summary.totalPowerWc).toBe(970);
  });

  it("falls back to the saved runtime panel snapshot when the catalog is not loaded", () => {
    const selected = resolveSelectedPvModulePower({
      selectedPanelId: "mod-saved",
      panelCatalog: [],
      runtimeSnapshot: { panelSpec: { id: "mod-saved", power_wc: 500 } },
    });

    expect(selected.source).toBe("runtime_panel_spec");
    expect(selected.unitPowerWc).toBe(500);
  });

  it("accepts official power aliases and comma decimals", () => {
    expect(resolvePvModulePowerWc({ powerWc: "425,5" })).toBe(425.5);
    expect(resolvePvModulePowerWc({ power_w: 410 })).toBe(410);
    expect(resolvePvModulePowerWc({ powerWp: "500" })).toBe(500);
  });

  it("rejects suspicious or missing power values instead of estimating them", () => {
    expect(resolvePvModulePowerWc({ power_wc: 0 })).toBeNull();
    expect(resolvePvModulePowerWc({ power_wc: 40 })).toBeNull();
    expect(resolvePvModulePowerWc({ widthM: 1.13, heightM: 1.72 })).toBeNull();
  });

  it("exposes countability from canonical placement validity", () => {
    expect(isPvPanelCountableForPower(panel("VALID"))).toBe(true);
    expect(isPvPanelCountableForPower(panel("INVALID"))).toBe(false);
  });
});
