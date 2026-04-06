/**
 * Tests unitaires validateInverterSizing — MICRO robuste + CENTRAL inchangé.
 * PHASE3-MICRO-STATUS-COUNTERS
 */

import { describe, it, expect } from "vitest";
import { validateInverterSizing } from "../inverterSizing";

describe("validateInverterSizing — MICRO", () => {
  it("MICRO + modules_per_inverter absent + panelSpec.isc_a absent → pas incompatible, warning présent", () => {
    const inv = { inverter_type: "micro", inverter_family: "MICRO" };
    const panelSpec = { power_wc: 400 };
    const result = validateInverterSizing({
      totalPanels: 3,
      totalPowerKwc: 1.2,
      inverter: inv,
      panelSpec,
    });
    expect(result.requiredUnits).toBe(3);
    expect(result.isDcPowerOk).toBe(true);
    expect(result.isCurrentOk).toBe(true);
    expect(result.isMpptOk).toBe(true);
    expect(result.isVoltageOk).toBe(true);
    const catalogueWarnings = result.warnings.filter((w) => w.indexOf("Catalogue incomplet") >= 0 || w.indexOf("modules_per_inverter") >= 0 || w.indexOf("isc_a") >= 0);
    expect(catalogueWarnings.length).toBeGreaterThan(0);
  });

  it("MICRO + panelCount=3, modules_per_inverter=1 → requiredUnits=3", () => {
    const inv = { inverter_type: "micro", inverter_family: "MICRO", modules_per_inverter: 1 };
    const panelSpec = { power_wc: 400, isc_a: 10 };
    const result = validateInverterSizing({
      totalPanels: 3,
      totalPowerKwc: 1.2,
      inverter: inv,
      panelSpec,
    });
    expect(result.requiredUnits).toBe(3);
  });

  it("MICRO + panelCount=5, modules_per_inverter=2 → requiredUnits=3", () => {
    const inv = { inverter_type: "micro", inverter_family: "MICRO", modules_per_inverter: 2 };
    const panelSpec = { power_wc: 400, isc_a: 10 };
    const result = validateInverterSizing({
      totalPanels: 5,
      totalPowerKwc: 2,
      inverter: inv,
      panelSpec,
    });
    expect(result.requiredUnits).toBe(3);
  });

  it("MICRO via inverter_type legacy (sans inverter_family) → reconnu", () => {
    const inv = { inverter_type: "micro", modules_per_inverter: 1 };
    const result = validateInverterSizing({
      totalPanels: 2,
      totalPowerKwc: 0.8,
      inverter: inv,
      panelSpec: { power_wc: 400 },
    });
    expect(result.requiredUnits).toBe(2);
  });
});

describe("validateInverterSizing — CENTRAL", () => {
  it("CENTRAL (string) → comportement inchangé, catalogue complet", () => {
    const inv = {
      inverter_type: "string",
      inverter_family: "CENTRAL",
      nominal_power_kw: 4,
      mppt_count: 2,
      mppt_min_v: 200,
      mppt_max_v: 600,
      max_input_current_a: 15,
      max_dc_power_kw: 5,
    };
    const panelSpec = { power_wc: 400, isc_a: 10, vmp_v: 40 };
    const result = validateInverterSizing({
      totalPanels: 10,
      totalPowerKwc: 4,
      inverter: inv,
      panelSpec,
    });
    expect(result.requiredUnits).toBe(1);
    expect(result.warnings.length).toBe(0);
  });

  it("counter refresh smoke: MICRO + 1 panel → requiredUnits=1", () => {
    const inv = { inverter_type: "micro", inverter_family: "MICRO", modules_per_inverter: 1 };
    const result = validateInverterSizing({
      totalPanels: 1,
      totalPowerKwc: 0.4,
      inverter: inv,
      panelSpec: { power_wc: 400 },
    });
    expect(result.requiredUnits).toBe(1);
  });

  it("CENTRAL catalogue incomplet → Incompatible (inchangé)", () => {
    const inv = { inverter_type: "string", nominal_power_kw: null };
    const result = validateInverterSizing({
      totalPanels: 10,
      totalPowerKwc: 4,
      inverter: inv,
      panelSpec: { power_wc: 400 },
    });
    expect(result.requiredUnits).toBe(0);
    expect(result.isDcPowerOk).toBe(false);
    expect(result.warnings.some((w) => w.indexOf("Catalogue incomplet") >= 0)).toBe(true);
  });
});
