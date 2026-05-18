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

test("isPdfBlockedByConfidence : PVGIS_FALLBACK_USED non bloquant", () => {
  const legacyStoredData = finalizeCalculationConfidence({
    blocking_warnings: ["PVGIS_FALLBACK_USED"],
    non_blocking_warnings: [],
    assumptions: {},
  });
  assert.equal(legacyStoredData.level, "BLOCKED");
  assert.ok(!isPdfBlockedByConfidence(legacyStoredData), "PVGIS_FALLBACK_USED seul ne doit pas bloquer les PDFs");

  const reallyBlocked = finalizeCalculationConfidence({
    blocking_warnings: ["CALC_INVALID_8760_PROFILE"],
    non_blocking_warnings: [],
    assumptions: {},
  });
  assert.ok(isPdfBlockedByConfidence(reallyBlocked), "CALC_INVALID_8760_PROFILE doit bloquer");
});

test("buildCalculationConfidenceFromCalc : VB sans cout - non bloquant", () => {
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
  assert.ok(!c.blocking_warnings.includes("VB_COST_UNCONFIGURED_BLOCK_PDF"), "pas dans blocking_warnings");
  assert.ok(c.non_blocking_warnings.includes("VB_COST_UNCONFIGURED_BLOCK_PDF"), "dans non_blocking_warnings");
  assert.ok(!isPdfBlockedByConfidence(c), "PDF ne doit pas etre bloque");
});

test("buildCalculationConfidenceFromCalc : VB_UNBOUNDED_DISABLED bloque toujours", () => {
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
      finance_warnings: [],
      anti_oversell_flags: ["VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE"],
    },
  };
  const c = buildCalculationConfidenceFromCalc(ctx, scenarios);
  assert.ok(c.blocking_warnings.includes("VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE"), "doit rester bloquant");
  assert.ok(isPdfBlockedByConfidence(c));
});
