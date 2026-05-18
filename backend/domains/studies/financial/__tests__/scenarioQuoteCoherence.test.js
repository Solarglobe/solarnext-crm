import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScenarioQuoteCoherenceError,
  validateScenarioQuoteCoherence,
} from "../scenarioQuoteCoherence.js";

test("accepts a locked scenario and quote inside contractual tolerances", () => {
  const validation = validateScenarioQuoteCoherence(
    {
      installation: {
        production_annuelle_kwh: 9280,
        puissance_kwc: 8.99,
      },
      finance: {
        capex_ttc: 18400,
        aides_total_eur: 780,
      },
    },
    {
      annual_production_kwh: 9280.8,
      total_ttc: 18400.99,
      aides_total_eur: 780,
      total_power_kwc: 8.999,
    }
  );

  assert.equal(validation.ok, true);
  assert.equal(validation.errors.length, 0);
});

test("blocks quote creation when production, cost, aids or power drift", () => {
  const validation = validateScenarioQuoteCoherence(
    {
      production: { annual_kwh: 10000 },
      finance: { capex_ttc: 21000, aides_total_eur: 1200 },
      installation: { puissance_kwc: 9 },
    },
    {
      production_annual_kwh: 10001.01,
      total_ttc: 21001.01,
      aides_total_eur: 1199.99,
      power_kwc: 9.011,
    }
  );

  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.errors.map((error) => error.key),
    ["productionAnnualKwh", "capexTtcEur", "aidsTotalEur", "powerKwc"]
  );

  const err = buildScenarioQuoteCoherenceError(validation);
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, "SCENARIO_QUOTE_COHERENCE_BLOCKED");
  assert.equal(err.details.length, 4);
});

test("requires comparable values except aids when both sides omit them", () => {
  const validation = validateScenarioQuoteCoherence(
    {
      energy: { production_kwh: 8000 },
      finance: { capex_ttc: 16000 },
      installation: { puissance_kwc: 6 },
    },
    {
      total_ttc: 16000,
      total_power_kwc: 6,
    }
  );

  assert.equal(validation.ok, false);
  assert.equal(validation.errors.length, 1);
  assert.equal(validation.errors[0].code, "MISSING_QUOTE_productionAnnualKwh");

  const aidsCheck = validation.checks.find((check) => check.key === "aidsTotalEur");
  assert.equal(aidsCheck.ok, true);
  assert.equal(aidsCheck.skipped, true);
});

