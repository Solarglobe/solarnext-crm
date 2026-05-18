import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  compareStorageEconomics,
  simulatePhysicalBattery8760,
  simulateStorageOptions8760,
  simulateVirtualBatteryContract8760,
  HOURS_PER_YEAR,
} from "../batterySimulator.js";

function zeros() {
  return new Array(HOURS_PER_YEAR).fill(0);
}

function assertApprox(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`
  );
}

function buildDailyRepeatedProfiles() {
  const pv = zeros();
  const load = zeros();
  for (let day = 0; day < 365; day++) {
    const offset = day * 24;
    pv[offset + 11] = 2;
    pv[offset + 12] = 4;
    pv[offset + 13] = 3;
    load[offset + 7] = 1;
    load[offset + 12] = 1;
    load[offset + 19] = 2;
  }
  return { pv, load };
}

describe("batterySimulator", () => {
  it("matches the documented expert spreadsheet reference case for a physical battery", () => {
    const pv = zeros();
    const load = zeros();
    pv[0] = 10;
    load[0] = 2;
    load[1] = 5;
    load[2] = 3;

    const result = simulatePhysicalBattery8760({
      productionHourlyKwh: pv,
      consumptionHourlyKwh: load,
      battery: {
        usableCapacityKwh: 6,
        depthOfDischargePct: 100,
        chargeEfficiencyPct: 90,
        dischargeEfficiencyPct: 90,
        annualDegradationPct: 2,
      },
    });

    assert.equal(result.ok, true);
    assertApprox(result.storedAnnualKwh, 6, 0.001, "stored energy");
    assertApprox(result.dischargeAnnualKwh, 5.4, 0.001, "discharged energy");
    assertApprox(result.selfConsumptionKwh, 7.4, 0.001, "autoconsumption with battery");
    assertApprox(result.injectionKwh, 1.333, 0.001, "remaining injection");
    assertApprox(result.gridImportKwh, 2.6, 0.001, "grid import");
    assertApprox(result.conversionLossesKwh, 1.267, 0.001, "conversion losses");
    assertApprox(result.selfConsumptionRate, 0.74, 0.0001, "self-consumption rate");
    assertApprox(result.selfSufficiencyRate, 0.74, 0.0001, "self-sufficiency rate");
    assert.equal(result.coherence.selfConsumptionNotDegraded, true);
    assert.equal(result.coherence.autonomyAtMost100Pct, true);
  });

  it("models physical battery aging over 25 years", () => {
    const { pv, load } = buildDailyRepeatedProfiles();
    const result = simulatePhysicalBattery8760({
      productionHourlyKwh: pv,
      consumptionHourlyKwh: load,
      analysisYears: 25,
      battery: {
        usableCapacityKwh: 4,
        depthOfDischargePct: 90,
        chargeEfficiencyPct: 95,
        dischargeEfficiencyPct: 94,
        annualDegradationPct: 2,
      },
    });

    assert.equal(result.agingYears.length, 25);
    assertApprox(result.agingYears[0].effectiveCapacityKwh, 3.6, 0.001, "year 1 effective capacity");
    assert.ok(result.agingYears[24].effectiveCapacityKwh < result.agingYears[0].effectiveCapacityKwh);
    assert.ok(result.agingYears[24].storedAnnualKwh <= result.agingYears[0].storedAnnualKwh + 1e-9);
  });

  it("matches the documented expert spreadsheet reference case for a virtual battery contract", () => {
    const pv = zeros();
    const load = zeros();
    pv[0] = 10;
    load[0] = 2;
    load[1] = 5;
    load[2] = 3;

    const result = simulateVirtualBatteryContract8760({
      productionHourlyKwh: pv,
      consumptionHourlyKwh: load,
      retailElectricityRateEurKwh: 0.25,
      virtualBattery: {
        annualCapKwh: 6,
        creditRateEurKwh: 0.05,
      },
    });

    assert.equal(result.ok, true);
    assertApprox(result.creditedAnnualKwh, 6, 0.001, "credited annual energy");
    assertApprox(result.usedCreditAnnualKwh, 6, 0.001, "used annual credit");
    assertApprox(result.overflowInjectionKwh, 2, 0.001, "overflow injection");
    assertApprox(result.billableImportKwh, 2, 0.001, "billable import");
    assertApprox(result.selfConsumptionKwh, 8, 0.001, "virtual autoconsumption");
    assertApprox(result.selfConsumptionRate, 0.8, 0.0001, "virtual self-consumption rate");
    assertApprox(result.selfSufficiencyRate, 0.8, 0.0001, "virtual self-sufficiency rate");
    assertApprox(result.netEconomicBenefitEur, 1.2, 0.001, "net economic benefit");
    assert.equal(result.coherence.creditedWithinAnnualCap, true);
  });

  it("guarantees autoconsumption with storage is never below baseline and autonomy never exceeds 100 percent", () => {
    const { pv, load } = buildDailyRepeatedProfiles();
    const physical = simulatePhysicalBattery8760({
      productionHourlyKwh: pv,
      consumptionHourlyKwh: load,
      battery: {
        usableCapacityKwh: 5,
        depthOfDischargePct: 80,
        chargeEfficiencyPct: 96,
        dischargeEfficiencyPct: 96,
      },
    });
    const virtual = simulateVirtualBatteryContract8760({
      productionHourlyKwh: pv,
      consumptionHourlyKwh: load,
      virtualBattery: {
        annualCapKwh: 1000,
        creditRateEurKwh: 0.04,
      },
      retailElectricityRateEurKwh: 0.24,
    });

    assert.ok(physical.selfConsumptionKwh >= physical.baseline.selfConsumptionKwh);
    assert.ok(virtual.selfConsumptionKwh >= virtual.baseline.selfConsumptionKwh);
    assert.ok(physical.selfSufficiencyRate <= 1);
    assert.ok(virtual.selfSufficiencyRate <= 1);
  });

  it("compares physical and virtual storage economics", () => {
    const physical = {
      baseline: { gridImportKwh: 1000 },
      gridImportKwh: 700,
    };
    const virtual = {
      usedCreditAnnualKwh: 200,
      grossImportSavingsEur: 60,
      netEconomicBenefitEur: 50,
    };

    const comparison = compareStorageEconomics({
      physicalBatteryResult: physical,
      virtualBatteryResult: virtual,
      physicalBatteryAnnualizedCostEur: 30,
    });

    assertApprox(comparison.physicalNetBenefitEur, 60, 0.001, "physical net benefit");
    assertApprox(comparison.virtualNetBenefitEur, 50, 0.001, "virtual net benefit");
    assert.equal(comparison.recommended, "PHYSICAL");
  });

  it("runs both storage options through the orchestration helper", () => {
    const { pv, load } = buildDailyRepeatedProfiles();
    const result = simulateStorageOptions8760({
      productionHourlyKwh: pv,
      consumptionHourlyKwh: load,
      retailElectricityRateEurKwh: 0.22,
      physicalBatteryAnnualizedCostEur: 250,
      physicalBattery: {
        usableCapacityKwh: 5,
        depthOfDischargePct: 90,
        chargeEfficiencyPct: 95,
        dischargeEfficiencyPct: 95,
        annualDegradationPct: 1.5,
      },
      virtualBattery: {
        annualCapKwh: 1500,
        creditRateEurKwh: 0.03,
      },
    });

    assert.equal(result.physical.ok, true);
    assert.equal(result.virtual.ok, true);
    assert.ok(["PHYSICAL", "VIRTUAL"].includes(result.economicsComparison.recommended));
  });
});
