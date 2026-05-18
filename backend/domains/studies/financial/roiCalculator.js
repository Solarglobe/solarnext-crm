const DEFAULT_HORIZON_YEARS = 25;
const DEFAULT_DISCOUNT_RATE = 0.04;
const IRR_TOLERANCE = 1e-12;
const IRR_MAX_ITERATIONS = 100;

// CRE S21 autoconsommation avec vente de surplus, trimestre tarifaire 2026-T2
// applicable du 01/04/2026 au 30/06/2026 selon les publications CRE relayees.
// Les tarifs sont injectables pour figer un snapshot contractuel par etude.
const DEFAULT_CRE_OA_SURPLUS_BRACKETS = Object.freeze([
  { maxKwc: 3, rateEurKwh: 0.04, label: "P <= 3 kWc" },
  { maxKwc: 9, rateEurKwh: 0.04, label: "3 < P <= 9 kWc" },
  { maxKwc: 36, rateEurKwh: 0.0473, label: "9 < P <= 36 kWc" },
  { maxKwc: 100, rateEurKwh: 0.0473, label: "36 < P <= 100 kWc" },
]);

function finiteNumber(value, fallback = null) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function positiveNumber(value, name) {
  const numberValue = finiteNumber(value);
  if (numberValue == null || numberValue <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
  return numberValue;
}

function nonNegativeNumber(value, name, fallback = 0) {
  const numberValue = value == null ? fallback : finiteNumber(value);
  if (numberValue == null || numberValue < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return numberValue;
}

function normalizeRate(value, fallback) {
  const numberValue = value == null ? fallback : finiteNumber(value, fallback);
  return Math.abs(numberValue) > 1 ? numberValue / 100 : numberValue;
}

function normalizePercent(value, fallbackPercent = 0) {
  const numberValue = value == null ? fallbackPercent : finiteNumber(value, fallbackPercent);
  return numberValue / 100;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

export function netPresentValue(cashflows, discountRate = DEFAULT_DISCOUNT_RATE) {
  if (!Array.isArray(cashflows) || cashflows.length === 0) {
    throw new TypeError("cashflows must be a non-empty array");
  }
  const rate = normalizeRate(discountRate, DEFAULT_DISCOUNT_RATE);
  return cashflows.reduce((total, value, year) => total + (Number(value) || 0) / ((1 + rate) ** year), 0);
}

function npvDerivative(cashflows, rate) {
  let derivative = 0;
  for (let year = 1; year < cashflows.length; year++) {
    derivative -= (year * cashflows[year]) / ((1 + rate) ** (year + 1));
  }
  return derivative;
}

function hasIrrSignChange(cashflows) {
  const hasPositive = cashflows.some((value) => Number(value) > 0);
  const hasNegative = cashflows.some((value) => Number(value) < 0);
  return hasPositive && hasNegative;
}

function bisectionIrr(cashflows) {
  let low = -0.999999;
  let high = 10;
  let lowNpv = netPresentValue(cashflows, low);
  let highNpv = netPresentValue(cashflows, high);

  while (lowNpv * highNpv > 0 && high < 1_000_000) {
    high *= 2;
    highNpv = netPresentValue(cashflows, high);
  }
  if (lowNpv * highNpv > 0) return null;

  for (let iteration = 0; iteration < IRR_MAX_ITERATIONS * 2; iteration++) {
    const mid = (low + high) / 2;
    const midNpv = netPresentValue(cashflows, mid);
    if (Math.abs(midNpv) < IRR_TOLERANCE || Math.abs(high - low) < IRR_TOLERANCE) return mid;
    if (lowNpv * midNpv <= 0) {
      high = mid;
      highNpv = midNpv;
    } else {
      low = mid;
      lowNpv = midNpv;
    }
  }

  return (low + high) / 2;
}

export function internalRateOfReturn(cashflows, guess = 0.08) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) {
    return { ok: false, reason: "INVALID_CASHFLOWS", irr: null };
  }
  const values = cashflows.map((value) => finiteNumber(value, 0));
  if (!hasIrrSignChange(values)) {
    return { ok: false, reason: "IRR_REQUIRES_POSITIVE_AND_NEGATIVE_CASHFLOWS", irr: null };
  }

  let rate = normalizeRate(guess, 0.08);
  for (let iteration = 0; iteration < IRR_MAX_ITERATIONS; iteration++) {
    const value = netPresentValue(values, rate);
    const derivative = npvDerivative(values, rate);
    if (Math.abs(derivative) < 1e-14) break;
    const nextRate = rate - value / derivative;
    if (!Number.isFinite(nextRate) || nextRate <= -0.999999) break;
    if (Math.abs(nextRate - rate) < IRR_TOLERANCE) {
      return { ok: true, irr: nextRate, method: "newton-raphson", iterations: iteration + 1 };
    }
    rate = nextRate;
  }

  const fallback = bisectionIrr(values);
  if (fallback == null) return { ok: false, reason: "IRR_DID_NOT_CONVERGE", irr: null };
  return { ok: true, irr: fallback, method: "bisection", iterations: null };
}

export function resolveOaBracket(powerKwc, brackets = DEFAULT_CRE_OA_SURPLUS_BRACKETS) {
  const power = positiveNumber(powerKwc, "oa.powerKwc");
  if (!Array.isArray(brackets) || brackets.length === 0) {
    throw new TypeError("oa.brackets must be a non-empty array");
  }
  const normalized = brackets
    .map((bracket) => ({
      maxKwc: positiveNumber(bracket.maxKwc, "oa.brackets[].maxKwc"),
      rateEurKwh: nonNegativeNumber(bracket.rateEurKwh, "oa.brackets[].rateEurKwh"),
      label: bracket.label ?? `P <= ${bracket.maxKwc} kWc`,
    }))
    .sort((left, right) => left.maxKwc - right.maxKwc);

  const bracket = normalized.find((candidate) => power <= candidate.maxKwc);
  if (!bracket) {
    return {
      ok: false,
      reason: "POWER_OUTSIDE_CRE_OA_BRACKETS",
      powerKwc: power,
      maxSupportedKwc: normalized[normalized.length - 1].maxKwc,
    };
  }

  return { ok: true, powerKwc: power, ...bracket };
}

export function computeObligationAchat({
  powerKwc,
  injectedKwhYear1,
  horizonYears = DEFAULT_HORIZON_YEARS,
  indexationPct = 0,
  annualDegradationPct = 0,
  brackets = DEFAULT_CRE_OA_SURPLUS_BRACKETS,
  explicitRateEurKwh = null,
} = {}) {
  const years = Math.max(1, Math.floor(positiveNumber(horizonYears, "oa.horizonYears")));
  const injected = nonNegativeNumber(injectedKwhYear1, "oa.injectedKwhYear1");
  const bracket = resolveOaBracket(powerKwc, brackets);
  if (!bracket.ok) return { ok: false, ...bracket, annual: [], totalRevenueEur: 0 };

  const baseRate = explicitRateEurKwh == null
    ? bracket.rateEurKwh
    : nonNegativeNumber(explicitRateEurKwh, "oa.explicitRateEurKwh");
  const indexation = normalizePercent(indexationPct, 0);
  const degradation = normalizePercent(annualDegradationPct, 0);
  const annual = [];

  let currentInjected = injected;
  let currentRate = baseRate;
  for (let year = 1; year <= years; year++) {
    const revenueEur = currentInjected * currentRate;
    annual.push({
      year,
      injectedKwh: round(currentInjected, 3),
      rateEurKwh: round(currentRate, 6),
      revenueEur: round(revenueEur, 2),
    });
    currentInjected *= 1 - degradation;
    currentRate *= 1 + indexation;
  }

  return {
    ok: true,
    powerKwc: bracket.powerKwc,
    bracketLabel: bracket.label,
    rateEurKwhYear1: baseRate,
    indexationPct: indexation * 100,
    annual,
    totalRevenueEur: round(sum(annual.map((item) => item.revenueEur)), 2),
  };
}

function buildAnnualCashflows(input) {
  if (Array.isArray(input.annualCashflowsEur)) {
    if (input.annualCashflowsEur.length === 0) throw new TypeError("annualCashflowsEur must not be empty");
    return input.annualCashflowsEur.map((value, index) => {
      const numberValue = finiteNumber(value);
      if (numberValue == null) throw new RangeError(`annualCashflowsEur[${index}] must be finite`);
      return numberValue;
    });
  }

  const years = Math.max(1, Math.floor(positiveNumber(input.horizonYears ?? DEFAULT_HORIZON_YEARS, "horizonYears")));
  const annualSavings = nonNegativeNumber(input.annualSavingsEur, "annualSavingsEur");
  const savingsGrowth = normalizePercent(input.annualSavingsGrowthPct, 0);
  const cashflows = [];
  let currentSavings = annualSavings;
  for (let year = 1; year <= years; year++) {
    cashflows.push(currentSavings);
    currentSavings *= 1 + savingsGrowth;
  }
  return cashflows;
}

function computePaybackYear(netCostEur, annualCashflowsEur) {
  let cumulative = -netCostEur;
  for (let index = 0; index < annualCashflowsEur.length; index++) {
    cumulative += annualCashflowsEur[index];
    if (cumulative >= 0) return index + 1;
  }
  return null;
}

function buildPlausibilityWarnings(paybackYear) {
  const warnings = [];
  if (paybackYear != null && paybackYear < 2) warnings.push("ROI_PAYBACK_UNDER_2_YEARS");
  if (paybackYear == null || paybackYear > 100) warnings.push("ROI_PAYBACK_OVER_100_YEARS");
  return warnings;
}

export function calculateRoiTriVan(input = {}) {
  const netCostEur = positiveNumber(input.netCostEur ?? input.coutNetEur, "netCostEur");
  const discountRate = input.discountRatePct != null
    ? normalizePercent(input.discountRatePct, DEFAULT_DISCOUNT_RATE * 100)
    : normalizeRate(input.discountRate ?? DEFAULT_DISCOUNT_RATE, DEFAULT_DISCOUNT_RATE);
  const annualCashflowsWithoutOa = buildAnnualCashflows(input);
  const horizonYears = annualCashflowsWithoutOa.length;

  const oa = input.oa
    ? computeObligationAchat({
        horizonYears,
        annualDegradationPct: input.oa.annualDegradationPct ?? input.annualProductionDegradationPct ?? 0,
        ...input.oa,
      })
    : null;
  if (oa && !oa.ok) {
    return {
      ok: false,
      reason: oa.reason,
      errors: [oa.reason],
      oa,
    };
  }

  const annualCashflowsEur = annualCashflowsWithoutOa.map((cashflow, index) => {
    const oaRevenue = input.includeOaInCashflows === false ? 0 : (oa?.annual[index]?.revenueEur ?? 0);
    return cashflow + oaRevenue;
  });
  const cumulativeSavingsEur = sum(annualCashflowsEur);
  const cashflows = [-netCostEur, ...annualCashflowsEur];
  const vanEur = netPresentValue(cashflows, discountRate);
  const irrResult = internalRateOfReturn(cashflows, input.irrGuess ?? 0.08);
  const paybackYear = computePaybackYear(netCostEur, annualCashflowsEur);
  const roiPct = ((cumulativeSavingsEur - netCostEur) / netCostEur) * 100;

  const errors = [];
  if (!irrResult.ok) errors.push(irrResult.reason);
  if (irrResult.ok && irrResult.irr > discountRate && vanEur <= 0) {
    errors.push("NPV_IRR_INCONSISTENCY");
  }
  if (irrResult.ok && irrResult.irr < discountRate && vanEur >= 0) {
    errors.push("NPV_IRR_INCONSISTENCY");
  }

  return {
    ok: errors.length === 0,
    errors,
    netCostEur: round(netCostEur, 2),
    horizonYears,
    discountRatePct: discountRate * 100,
    annualCashflowsEur: annualCashflowsEur.map((value) => round(value, 2)),
    cumulativeSavingsEur: round(cumulativeSavingsEur, 2),
    roiPct: round(roiPct, 6),
    paybackYear,
    triPct: irrResult.ok ? round(irrResult.irr * 100, 6) : null,
    irr: irrResult.ok ? irrResult.irr : null,
    irrMeta: irrResult,
    vanEur: round(vanEur, 2),
    oa,
    warnings: buildPlausibilityWarnings(paybackYear),
  };
}

export { DEFAULT_CRE_OA_SURPLUS_BRACKETS, DEFAULT_DISCOUNT_RATE, DEFAULT_HORIZON_YEARS };
