import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalculationConfidenceFromCalc,
  finalizeCalculationConfidence,
  isPdfBlockedByConfidence,
} from "../services/calculationConfidence.service.js";

test("buildCalculationConfidenceFromCalc : VB unbounded commercial bloque PDF", () => {
  const ctx = {
    pv: { source: "PVGIS" },
    meta: { engine_consumption_source: "SYNTHETIC_MANUAL_PROFILE" },
    form: { economics: {} },
    settings: { economics: {} },
    virtual_battery_input: { enabled: true },
  };
  const scenarios = {
    BATTERY_VIRTUAL: {
      _skipped: true,
      oversell_risk_score: 100,
      anti_oversell_flags: ["VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE", "VB_CAPACITY_AUTO_UNBOUNDED"],
      finance_warnings: ["VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE", "VB_CAPACITY_AUTO_UNBOUNDED"],
    },
  };
  const c = buildCalculationConfidenceFromCalc(ctx, scenarios);
  assert.equal(c.level, "BLOCKED");
  assert.ok(c.blocking_warnings.includes("VB_UNBOUNDED_DISABLED_FOR_COMMERCIAL_USE"));
  assert.ok(isPdfBlockedByConfidence(c));
});

test("finalizeCalculationConfidence : score anti-survente eleve downgrade LOW", () => {
  const c = finalizeCalculationConfidence({
    blocking_warnings: [],
    non_blocking_warnings: ["VB_AUTONOMY_OVER_85"],
    assumptions: { enedis_profile_used: false, oversell_risk_score: 85 },
  });
  assert.equal(c.level, "LOW");
});
