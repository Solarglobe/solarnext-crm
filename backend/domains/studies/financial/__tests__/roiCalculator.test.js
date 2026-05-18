import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  calculateRoiTriVan,
  computeObligationAchat,
  internalRateOfReturn,
  netPresentValue,
  resolveOaBracket,
} from "../roiCalculator.js";

const TEST_OA_BRACKETS = Object.freeze([
  { maxKwc: 3, rateEurKwh: 0.10, label: "P <= 3 kWc" },
  { maxKwc: 9, rateEurKwh: 0.08, label: "3 < P <= 9 kWc" },
  { maxKwc: 36, rateEurKwh: 0.07, label: "9 < P <= 36 kWc" },
  { maxKwc: 100, rateEurKwh: 0.055, label: "36 < P <= 100 kWc" },
]);

function assertApprox(actual, expected, tolerance, message) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, got ${actual}`
  );
}

function growingCashflows(firstYear, growthPct, years = 25) {
  return Array.from({ length: years }, (_, index) => firstYear * ((1 + growthPct / 100) ** index));
}

describe("roiCalculator", () => {
  it("validates 5 documented industrial ROI/TRI/VAN reference cases to cents and 0.001 percent", () => {
    const cases = [
      {
        name: "Residential 6 kWc flat savings",
        input: {
          netCostEur: 12000,
          annualCashflowsEur: Array(25).fill(1100),
          discountRatePct: 4,
        },
        expected: { roiPct: 129.166667, paybackYear: 11, triPct: 7.747510, vanEur: 5184.29 },
      },
      {
        name: "SME self-consumption with 2 percent energy inflation",
        input: {
          netCostEur: 28000,
          annualCashflowsEur: growingCashflows(1800, 2),
          discountRatePct: 4,
        },
        expected: { roiPct: 105.909070, paybackYear: 14, triPct: 5.930663, vanEur: 6612.30 },
      },
      {
        name: "Industrial case below discount-rate threshold",
        input: {
          netCostEur: 75000,
          annualCashflowsEur: growingCashflows(5200, -0.5),
          discountRatePct: 5,
        },
        expected: { roiPct: 63.321263, paybackYear: 15, triPct: 4.296449, vanEur: -5085.72 },
      },
      {
        name: "Residential with indexed OA surplus",
        input: {
          netCostEur: 9500,
          annualCashflowsEur: Array(25).fill(850),
          discountRatePct: 4,
          oa: {
            powerKwc: 6,
            injectedKwhYear1: 1800,
            indexationPct: 1,
            brackets: [
              { maxKwc: 3, rateEurKwh: 0.10 },
              { maxKwc: 9, rateEurKwh: 0.08 },
              { maxKwc: 36, rateEurKwh: 0.06 },
              { maxKwc: 100, rateEurKwh: 0.05 },
            ],
          },
        },
        expected: { roiPct: 166.495053, paybackYear: 10, triPct: 9.488547, vanEur: 6269.68, oaTotal: 4067.03 },
      },
      {
        name: "Enterprise 80 kWc with OA indexation and PV degradation",
        input: {
          netCostEur: 400000,
          annualCashflowsEur: growingCashflows(26000, 1),
          discountRatePct: 4.5,
          oa: {
            powerKwc: 80,
            injectedKwhYear1: 120000,
            indexationPct: 0.5,
            annualDegradationPct: 0.4,
            brackets: TEST_OA_BRACKETS,
          },
        },
        expected: { roiPct: 125.319559, paybackYear: 12, triPct: 7.226192, vanEur: 124684.98, oaTotal: 166955.05 },
      },
    ];

    for (const reference of cases) {
      const result = calculateRoiTriVan(reference.input);
      assert.equal(result.ok, true, `${reference.name}: ${result.errors.join("; ")}`);
      assertApprox(result.roiPct, reference.expected.roiPct, 0.000001, `${reference.name} ROI`);
      assert.equal(result.paybackYear, reference.expected.paybackYear, `${reference.name} payback`);
      assertApprox(result.triPct, reference.expected.triPct, 0.001, `${reference.name} TRI`);
      assertApprox(result.vanEur, reference.expected.vanEur, 0.01, `${reference.name} VAN`);
      if (reference.expected.oaTotal != null) {
        assertApprox(result.oa.totalRevenueEur, reference.expected.oaTotal, 0.01, `${reference.name} OA total`);
      }

      if (result.triPct > result.discountRatePct) assert.ok(result.vanEur > 0, `${reference.name} TRI/VAN positive`);
      if (result.triPct < result.discountRatePct) assert.ok(result.vanEur < 0, `${reference.name} TRI/VAN negative`);
    }
  });

  it("is deterministic: same parameters produce the same TRI within 0.001 percent", () => {
    const input = {
      netCostEur: 18450,
      annualCashflowsEur: growingCashflows(1450, 1.4),
      discountRatePct: 4,
      oa: {
        powerKwc: 8.8,
        injectedKwhYear1: 2100,
        indexationPct: 0.7,
        brackets: TEST_OA_BRACKETS,
      },
    };

    const first = calculateRoiTriVan(input);
    const second = calculateRoiTriVan(input);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assertApprox(first.triPct, second.triPct, 0.001, "deterministic TRI");
  });

  it("returns an explicit error when IRR cannot be calculated from all-negative flows", () => {
    const result = internalRateOfReturn([-10000, -500, -200, -50]);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "IRR_REQUIRES_POSITIVE_AND_NEGATIVE_CASHFLOWS");

    const roi = calculateRoiTriVan({
      netCostEur: 10000,
      annualCashflowsEur: Array(25).fill(-100),
      discountRatePct: 4,
    });
    assert.equal(roi.ok, false);
    assert.ok(roi.errors.includes("IRR_REQUIRES_POSITIVE_AND_NEGATIVE_CASHFLOWS"));
  });

  it("validates CRE OA bracket boundaries and rejects unsupported power", () => {
    assert.equal(resolveOaBracket(3, TEST_OA_BRACKETS).label, "P <= 3 kWc");
    assert.equal(resolveOaBracket(9, TEST_OA_BRACKETS).label, "3 < P <= 9 kWc");
    assert.equal(resolveOaBracket(36, TEST_OA_BRACKETS).label, "9 < P <= 36 kWc");
    assert.equal(resolveOaBracket(100, TEST_OA_BRACKETS).label, "36 < P <= 100 kWc");

    const outside = resolveOaBracket(101, TEST_OA_BRACKETS);
    assert.equal(outside.ok, false);
    assert.equal(outside.reason, "POWER_OUTSIDE_CRE_OA_BRACKETS");

    const oa = computeObligationAchat({
      powerKwc: 101,
      injectedKwhYear1: 1000,
      brackets: TEST_OA_BRACKETS,
    });
    assert.equal(oa.ok, false);
    assert.equal(oa.reason, "POWER_OUTSIDE_CRE_OA_BRACKETS");
  });

  it("raises plausibility warnings without blocking suspicious payback durations", () => {
    const tooFast = calculateRoiTriVan({
      netCostEur: 10000,
      annualCashflowsEur: Array(25).fill(11000),
      discountRatePct: 4,
    });
    assert.equal(tooFast.ok, true);
    assert.ok(tooFast.warnings.includes("ROI_PAYBACK_UNDER_2_YEARS"));

    const tooSlow = calculateRoiTriVan({
      netCostEur: 10000,
      annualCashflowsEur: Array(25).fill(10),
      discountRatePct: 4,
    });
    assert.equal(tooSlow.ok, true);
    assert.ok(tooSlow.warnings.includes("ROI_PAYBACK_OVER_100_YEARS"));
  });

  it("computes NPV independently from cashflows", () => {
    const cashflows = [-1000, 400, 400, 400];
    assertApprox(netPresentValue(cashflows, 0.04), 110.04, 0.01, "NPV");
  });
});
