import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalculationConfidenceFromCalc,
  finalizeCalculationConfidence,
  isPdfBlockedByConfidence,
} from "../services/calculationConfidence.service.js";

test("finalizeCalculationConfidence : BLOCKED si avertissement bloquant", () => {
  const c = finalizeCalculationConfidence({
    blocking_warnings: ["CALC_INVALID_8760_PROFILE"],
    non_blocking_warnings: [],
    assumptions: { enedis_profile_used: true },
  });
  assert.equal(c.level, "BLOCKED");
  assert.ok(isPdfBlockedByConfidence(c));
});

test("isPdfBlockedByConfidence : PVGIS fallback dans blocking_warnings", () => {
  const c = finalizeCalculationConfidence({
    blocking_warnings: ["PVGIS_FALLBACK_USED"],
    non_blocking_warnings: [],
    assumptions: {},
  });
  assert.ok(isPdfBlockedByConfidence(c));
});

test("buildCalculationConfidenceFromCalc : VB sans coût → blocking VB_COST_UNCONFIGURED_BLOCK_PDF", () => {
  const ctx = {
    pv: { source: "PVGIS" },
    meta: { engine_consumption_source: "CSV_HOURLY_ENEDIS" },
    form: { economics: {} },
    settings: { economics: {} },
    virtual_battery_input: { enabled: true },
  };
  const scenarios = {
    BATTERY_VIRTUAL: {
      _skipped: false,
      finance_warnings: ["VB_COST_UNCONFIGURED"],
    },
  };
  const c = buildCalculationConfidenceFromCalc(ctx, scenarios);
  assert.ok(c.blocking_warnings.includes("VB_COST_UNCONFIGURED_BLOCK_PDF"));
  assert.ok(isPdfBlockedByConfidence(c));
});
