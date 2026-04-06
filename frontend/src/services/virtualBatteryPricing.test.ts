/**
 * Tests résolveur tarifaire batterie virtuelle (BATTERY-GRID-2026).
 * Cas 1: MYLIGHT_MYBATTERY, BASE, kVA=9, PV=6 kWc
 * Cas 2: URBAN_SOLAR, HPHC, kVA=12, PV=5 kWc
 * Cas 3: MYLIGHT_MYSMARTBATTERY, capacity=300
 */

import { describe, it, expect } from "vitest";
import { resolveVirtualBatteryPricing } from "./virtualBatteryPricing";
import { getVirtualBatteryTariffs2026 } from "../data/virtualBatteryTariffs2026";

const grids = getVirtualBatteryTariffs2026();

describe("resolveVirtualBatteryPricing", () => {
  it("cas 1: MYLIGHT_MYBATTERY, BASE, kVA=9, PV=6 kWc", () => {
    const result = resolveVirtualBatteryPricing(grids, {
      provider: "MYLIGHT_MYBATTERY",
      contractType: "BASE",
      meterPowerKva: 9,
      pvPowerKwc: 6,
    });
    expect(result).not.toBeNull();
    expect(result!.aboStockageMonthly).toBeCloseTo(6, 2); // 1 €/kWc * 6 = 6 €
    expect(result!.aboFournisseurMonthly).toBeCloseTo(14.46, 2); // MyLight BASE 9 kVA
    expect(result!.contributionMonthly).toBeCloseTo(3.96 / 12, 2); // 0.33
    expect(result!.totalMonthly).toBeCloseTo(6 + 14.46 + 3.96 / 12, 2);
  });

  it("cas 2: URBAN_SOLAR, HPHC, kVA=12, PV=5 kWc", () => {
    const result = resolveVirtualBatteryPricing(grids, {
      provider: "URBAN_SOLAR",
      contractType: "HPHC",
      meterPowerKva: 12,
      pvPowerKwc: 5,
    });
    expect(result).not.toBeNull();
    expect(result!.aboStockageMonthly).toBeCloseTo(5, 2); // 1 €/kWc * 5
    expect(result!.aboFournisseurMonthly).toBeCloseTo(16.9, 2); // Urban HPHC 12 kVA
    expect(result!.contributionMonthly).toBeCloseTo(9.6 / 12, 2); // 0.8
    expect(result!.totalMonthly).toBeGreaterThan(0);
  });

  it("cas 3: MYLIGHT_MYSMARTBATTERY, capacity=300 kWh", () => {
    const result = resolveVirtualBatteryPricing(grids, {
      provider: "MYLIGHT_MYSMARTBATTERY",
      contractType: "BASE",
      meterPowerKva: 9,
      pvPowerKwc: 6,
      capacityKwh: 300,
    });
    expect(result).not.toBeNull();
    expect(result!.aboStockageMonthly).toBeCloseTo(22.49, 2); // tier 300 kWh
    expect(result!.aboFournisseurMonthly).toBe(0);
    expect(result!.contributionMonthly).toBeCloseTo((3.96 * 9) / 12, 2); // 2.97
    expect(result!.totalMonthly).toBeCloseTo(22.49 + (3.96 * 9) / 12, 2);
  });
});
