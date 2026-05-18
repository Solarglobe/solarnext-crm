import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateHourlyByMonth,
  calculateEnergy8760,
  validateEnergyResult,
  HOURS_PER_YEAR,
} from "../energyCalculator.js";

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assertRelativeDiffWithin(actual, expected, tolerancePct, message) {
  const diffPct = expected === 0 ? (actual === 0 ? 0 : Infinity) : (Math.abs(actual - expected) / Math.abs(expected)) * 100;
  assert.ok(diffPct <= tolerancePct, `${message}: diff=${diffPct}% actual=${actual} expected=${expected}`);
}

describe("energyCalculator", () => {
  it("produces coherent monthly, annual and 8760h production with strict physical peak", () => {
    const monthlyProductionKwh = [520, 670, 930, 1150, 1350, 1450, 1500, 1450, 1200, 880, 600, 480];
    const annualProductionKwh = sum(monthlyProductionKwh);

    const result = calculateEnergy8760({
      peakPowerKwc: 12,
      monthlyProductionKwh,
      annualProductionKwh,
      annualConsumptionKwh: 7800,
    });

    assert.equal(result.productionHourlyWh.length, HOURS_PER_YEAR);
    assert.equal(result.consumptionHourlyWh.length, HOURS_PER_YEAR);
    assert.equal(result.injectionHourlyWh.length, HOURS_PER_YEAR);
    assert.equal(result.selfConsumptionHourlyWh.length, HOURS_PER_YEAR);
    assert.equal(result.coherence.ok, true, result.coherence.errors.join("; "));

    assertRelativeDiffWithin(sum(result.productionMonthlyWh), result.productionAnnualWh, 0.1, "monthly sum equals annual");

    const monthlyFromHourly = aggregateHourlyByMonth(result.productionHourlyWh);
    for (let month = 0; month < 12; month++) {
      assertRelativeDiffWithin(monthlyFromHourly[month], result.productionMonthlyWh[month], 0.01, `month ${month + 1}`);
    }

    assert.ok(result.productionHourlyWh.every((value) => value >= 0));
    assert.ok(Math.max(...result.productionHourlyWh) <= 12_000 + 1e-6);

    for (let index = 0; index < HOURS_PER_YEAR; index++) {
      const production = result.productionHourlyWh[index];
      const consumption = result.consumptionHourlyWh[index];
      assert.equal(result.injectionHourlyWh[index], Math.max(0, production - consumption));
      assert.equal(result.selfConsumptionHourlyWh[index], Math.min(production, consumption));
    }

    assert.equal(result.selfConsumptionRate, result.selfConsumptionAnnualWh / result.productionAnnualWh);
    assert.equal(result.selfSufficiencyRate, result.selfConsumptionAnnualWh / result.consumptionAnnualWh);
  });

  it("keeps zero-production polar months exactly at zero, including December", () => {
    const monthlyProductionKwh = [0, 0, 0, 0, 0, 800, 950, 0, 0, 0, 0, 0];
    const result = calculateEnergy8760({
      peakPowerKwc: 6,
      monthlyProductionKwh,
      annualConsumptionKwh: 4200,
    });

    assert.equal(result.coherence.ok, true, result.coherence.errors.join("; "));

    const monthlyFromHourly = aggregateHourlyByMonth(result.productionHourlyWh);
    assert.equal(monthlyFromHourly[11], 0);
    assert.equal(result.productionMonthlyWh[11], 0);
    assert.equal(sum(result.productionHourlyWh.slice(8016, 8760)), 0);
  });

  it("accepts a client-provided 8760h consumption vector and computes energy balances", () => {
    const consumptionHourlyWh = new Array(HOURS_PER_YEAR).fill(500);
    const result = calculateEnergy8760({
      peakPowerKwc: 4,
      monthlyProductionKwh: [120, 160, 230, 310, 380, 420, 440, 410, 320, 240, 150, 110],
      annualConsumptionKwh: 999999,
      consumptionHourlyWh,
    });

    assert.deepEqual(result.consumptionHourlyWh, consumptionHourlyWh);
    assert.equal(result.consumptionAnnualWh, 4_380_000);
    assert.equal(result.coherence.ok, true, result.coherence.errors.join("; "));
    assert.ok(result.selfConsumptionRate >= 0 && result.selfConsumptionRate <= 1);
    assert.ok(result.selfSufficiencyRate >= 0 && result.selfSufficiencyRate <= 1);
  });

  it("reports annual mismatch beyond 0.1 percent", () => {
    const valid = calculateEnergy8760({
      peakPowerKwc: 5,
      monthlyProductionKwh: [100, 120, 180, 230, 260, 290, 300, 280, 220, 160, 110, 90],
      annualProductionKwh: 2340,
      annualConsumptionKwh: 3000,
    });

    const invalid = {
      ...valid,
      productionAnnualWh: valid.productionAnnualWh * 1.01,
    };
    const report = validateEnergyResult(invalid, { peakPowerKwc: 5 });

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes("monthly/annual")));
  });

  it("reports hourly/monthly drift beyond 0.01 percent", () => {
    const result = calculateEnergy8760({
      peakPowerKwc: 5,
      monthlyProductionKwh: [100, 120, 180, 230, 260, 290, 300, 280, 220, 160, 110, 90],
      annualConsumptionKwh: 3000,
    });

    const invalid = {
      ...result,
      productionHourlyWh: result.productionHourlyWh.slice(),
    };
    invalid.productionHourlyWh[0] += 500;

    const report = validateEnergyResult(invalid, { peakPowerKwc: 5 });

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes("hourly/monthly")));
  });

  it("rejects physically impossible monthly production for the installed peak power", () => {
    assert.throws(
      () => calculateEnergy8760({
        peakPowerKwc: 1,
        monthlyProductionKwh: [900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        annualConsumptionKwh: 1000,
      }),
      /physical monthly maximum/
    );
  });

  it("detects negative production and physical peak violations in validation", () => {
    const result = calculateEnergy8760({
      peakPowerKwc: 3,
      monthlyProductionKwh: [80, 100, 140, 180, 220, 240, 250, 230, 180, 130, 90, 70],
      annualConsumptionKwh: 2800,
    });

    const invalid = {
      ...result,
      productionHourlyWh: result.productionHourlyWh.slice(),
    };
    invalid.productionHourlyWh[10] = -1;
    invalid.productionHourlyWh[11] = 4000;

    const report = validateEnergyResult(invalid, { peakPowerKwc: 3 });

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes("negative hourly production")));
    assert.ok(report.errors.some((error) => error.includes("physical peak exceeded")));
  });
});
