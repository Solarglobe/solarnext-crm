import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FINANCIAL_ENGINE_VERSION, ENGINE_VERSION } from "../constants/engineVersion.js";
import { computeFinance } from "../services/financeService.js";
import {
  buildFinancialRegressionReport,
  compareFinancialScenarioResults,
} from "../services/financialRegressionReport.service.js";

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/financialRegressionCases.json", import.meta.url), "utf8")
);

function assertWithinRelativeTolerance(actual, expected, label, tolerancePct = 0.01) {
  if (expected == null) {
    assert.equal(actual, expected, label);
    return;
  }
  const diffPct = expected === 0 ? Math.abs(actual - expected) : Math.abs((actual - expected) / expected) * 100;
  assert.ok(
    diffPct <= tolerancePct,
    `${label}: expected ${expected}, got ${actual}, diff ${diffPct}% > ${tolerancePct}%`
  );
}

test("financial engine version is semver and kept as the legacy ENGINE_VERSION alias", () => {
  assert.match(FINANCIAL_ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(ENGINE_VERSION, FINANCIAL_ENGINE_VERSION);
  assert.equal(FINANCIAL_ENGINE_VERSION, "2.1.0");
});

test("financial engine regression fixtures stay within 0.01 percent", async () => {
  assert.equal(fixtures.length, 10);

  for (const fixture of fixtures) {
    const previousLog = console.log;
    const previousWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    let out;
    try {
      out = await computeFinance(fixture.ctx, fixture.scenarios);
    } finally {
      console.log = previousLog;
      console.warn = previousWarn;
    }
    for (const [scenarioId, expected] of Object.entries(fixture.expected)) {
      const actual = out.scenarios[scenarioId];
      assert.ok(actual, `${fixture.name}.${scenarioId} missing`);
      for (const [key, expectedValue] of Object.entries(expected)) {
        assertWithinRelativeTolerance(actual[key], expectedValue, `${fixture.name}.${scenarioId}.${key}`);
      }
    }
  }
});

test("regression report counts scenarios affected by a financial engine update", () => {
  const rows = [
    {
      id: "fs-1",
      study_id: "study-1",
      study_version_id: "version-1",
      scenario_id: "BASE",
      engine_version: "2.0.0",
      results: { capex_ttc: 10000, roi_years: 10, irr_pct: 8 },
    },
    {
      id: "fs-2",
      study_id: "study-2",
      study_version_id: "version-2",
      scenario_id: "BASE",
      engine_version: "2.0.0",
      results: { capex_ttc: 10000, roi_years: 10, irr_pct: 8 },
    },
  ];

  const report = buildFinancialRegressionReport(
    rows,
    {
      "fs-1": { capex_ttc: 10000, roi_years: 10, irr_pct: 8.0005 },
      "fs-2": { capex_ttc: 10000, roi_years: 10.1, irr_pct: 8 },
    },
    { fromVersion: "2.0.0", toVersion: "2.1.0" }
  );

  assert.equal(report.scanned_count, 2);
  assert.equal(report.affected_count, 1);
  assert.match(report.message, /1 scenarios affectes/);
  assert.equal(report.affected[0].financial_scenario_id, "fs-2");
});

test("comparison tolerance is exactly 0.01 percent by default", () => {
  assert.equal(compareFinancialScenarioResults({ roi_years: 10 }, { roi_years: 10.001 }).affected, false);
  assert.equal(compareFinancialScenarioResults({ roi_years: 10 }, { roi_years: 10.002 }).affected, true);
});
