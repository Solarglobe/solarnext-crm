import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  aggregateHourlyByMonth,
  calculateEnergy8760,
} from "../energyCalculator.js";
import {
  simulatePhysicalBattery8760,
  simulateVirtualBatteryContract8760,
  HOURS_PER_YEAR,
} from "../batterySimulator.js";
import {
  resolveOaBracket,
} from "../roiCalculator.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../e2e/fixtures/pv-financial-reference-scenarios.json"
);
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8"));

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function expandDaily(values) {
  const hourly = [];
  for (let day = 0; day < 365; day++) hourly.push(...values);
  assert.equal(hourly.length, HOURS_PER_YEAR);
  return hourly;
}

function diffPct(actual, expected) {
  return expected === 0 ? (actual === 0 ? 0 : Infinity) : (Math.abs(actual - expected) / Math.abs(expected)) * 100;
}

describe("PV and financial reference fixtures", () => {
  it("keeps monthly, annual and 8760h production coherent on 5 documented sites", () => {
    assert.equal(fixtures.energySites.length, 5);

    for (const site of fixtures.energySites) {
      const expectedAnnualKwh = sum(site.monthlyProductionKwh);
      const result = calculateEnergy8760({
        ...site,
        annualProductionKwh: expectedAnnualKwh,
      });

      assert.equal(result.coherence.ok, true, `${site.name}: ${result.coherence.errors.join("; ")}`);
      assert.ok(diffPct(sum(result.productionMonthlyWh), result.productionAnnualWh) <= 0.1, site.name);

      const monthlyFromHourly = aggregateHourlyByMonth(result.productionHourlyWh);
      for (let month = 0; month < 12; month++) {
        assert.ok(
          diffPct(monthlyFromHourly[month], result.productionMonthlyWh[month]) <= 0.01,
          `${site.name} month ${month + 1}`
        );
      }
      assert.ok(Math.max(...result.productionHourlyWh) <= site.peakPowerKwc * 1000 + 1e-6, site.name);
      assert.ok(result.productionHourlyWh.every((value) => value >= 0), site.name);
    }
  });

  it("covers reference battery modes: none, full physical battery and virtual battery", () => {
    for (const scenario of fixtures.batteryCases) {
      const productionHourlyKwh = expandDaily(scenario.dailyPvKwh);
      const consumptionHourlyKwh = expandDaily(scenario.dailyLoadKwh);

      if (scenario.type === "none") {
        const noBattery = simulatePhysicalBattery8760({
          productionHourlyKwh,
          consumptionHourlyKwh,
          battery: {
            usableCapacityKwh: 0.000001,
            depthOfDischargePct: 100,
            chargeEfficiencyPct: 100,
            dischargeEfficiencyPct: 100,
          },
        });
        assert.ok(noBattery.selfConsumptionKwh >= noBattery.baseline.selfConsumptionKwh);
        assert.ok(noBattery.selfConsumptionKwh <= noBattery.baseline.selfConsumptionKwh + 0.01);
        continue;
      }

      if (scenario.type === "physical") {
        const physical = simulatePhysicalBattery8760({
          productionHourlyKwh,
          consumptionHourlyKwh,
          battery: scenario.battery,
        });
        assert.equal(physical.ok, true);
        assert.ok(physical.selfConsumptionKwh >= physical.baseline.selfConsumptionKwh);
        assert.ok(physical.selfSufficiencyRate <= 1);
        assert.ok(physical.storedAnnualKwh > 0);
        continue;
      }

      const virtual = simulateVirtualBatteryContract8760({
        productionHourlyKwh,
        consumptionHourlyKwh,
        virtualBattery: scenario.virtualBattery,
        retailElectricityRateEurKwh: scenario.retailElectricityRateEurKwh,
      });
      assert.equal(virtual.ok, true);
      assert.ok(virtual.selfConsumptionKwh >= virtual.baseline.selfConsumptionKwh);
      assert.ok(virtual.selfSufficiencyRate <= 1);
      assert.ok(virtual.creditedAnnualKwh <= scenario.virtualBattery.annualCapKwh + 1e-9);
    }
  });

  it("keeps CRE OA rates stable on all supported power brackets", () => {
    for (const check of fixtures.oaBracketChecks) {
      const bracket = resolveOaBracket(check.powerKwc);
      assert.equal(bracket.ok, true);
      assert.equal(bracket.label, check.expectedLabel);
      assert.equal(bracket.rateEurKwh, check.expectedRateEurKwh);
    }

    assert.equal(resolveOaBracket(100.01).ok, false);
  });
});
