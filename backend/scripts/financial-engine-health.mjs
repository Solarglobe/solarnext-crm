import assert from "node:assert/strict";

import { calculateRoiTriVan } from "../domains/studies/financial/roiCalculator.js";
import { FINANCIAL_ENGINE_VERSION } from "../constants/engineVersion.js";

const result = calculateRoiTriVan({
  netCostEur: 12000,
  annualSavingsEur: 1350,
  annualSavingsGrowthPct: 2,
  horizonYears: 25,
  discountRate: 0.04,
  oa: {
    powerKwc: 6,
    injectedKwhYear1: 1800,
    indexationPct: 1,
    annualDegradationPct: 0.5,
  },
});

assert.equal(result.ok, true, result.errors?.join("; "));
assert.equal(FINANCIAL_ENGINE_VERSION, "2.1.0");
assert.ok(result.triPct > 0, "TRI must be positive on reference scenario");
assert.ok(result.vanEur > 0, "VAN must be positive on reference scenario");

console.log(JSON.stringify({
  ok: true,
  engineVersion: FINANCIAL_ENGINE_VERSION,
  reference: {
    roiPct: result.roiPct,
    triPct: result.triPct,
    vanEur: result.vanEur,
    paybackYear: result.paybackYear,
  },
}));
