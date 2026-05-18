const DEFAULT_TOLERANCES = Object.freeze({
  productionAnnualKwh: 1,
  capexTtcEur: 1,
  powerKwc: 0.01,
});

const CHECKS = Object.freeze({
  productionAnnualKwh: {
    label: "Production annuelle",
    unit: "kWh",
    tolerance: DEFAULT_TOLERANCES.productionAnnualKwh,
  },
  capexTtcEur: {
    label: "Cout installation TTC",
    unit: "EUR",
    tolerance: DEFAULT_TOLERANCES.capexTtcEur,
  },
  aidsTotalEur: {
    label: "Aides",
    unit: "EUR",
    tolerance: 0,
    exactMoney: true,
    optionalWhenBothMissing: true,
  },
  powerKwc: {
    label: "Puissance crete",
    unit: "kWc",
    tolerance: DEFAULT_TOLERANCES.powerKwc,
  },
});

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money2(value) {
  const n = asNumber(value);
  return n == null ? null : Math.round(n * 100) / 100;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = asNumber(value);
    if (n != null) return n;
  }
  return null;
}

function readPath(source, path) {
  if (!source || typeof source !== "object") return undefined;
  return path.split(".").reduce((current, key) => {
    if (current == null || typeof current !== "object") return undefined;
    return current[key];
  }, source);
}

function firstPathNumber(source, paths) {
  return firstNumber(...paths.map((path) => readPath(source, path)));
}

export function normalizeScenarioFinancialReference(scenario = {}) {
  return {
    productionAnnualKwh: firstPathNumber(scenario, [
      "production.annual_kwh",
      "production.annualProductionKwh",
      "energy.production_kwh",
      "energy.productionAnnualKwh",
      "installation.production_annuelle_kwh",
      "installation.productionAnnualKwh",
      "annual_production_kwh",
      "production_annual_kwh",
    ]),
    capexTtcEur: firstPathNumber(scenario, [
      "finance.capex_ttc",
      "finance.capexTtc",
      "finance.installation_cost_ttc",
      "capex.total_ttc",
      "capex_ttc",
      "installation.cost_ttc",
    ]),
    aidsTotalEur: firstPathNumber(scenario, [
      "finance.aides_total_eur",
      "finance.aids_total_eur",
      "finance.aides_eur",
      "finance.prime_eur",
      "aides_total_eur",
      "aids_total_eur",
    ]),
    powerKwc: firstPathNumber(scenario, [
      "installation.puissance_kwc",
      "installation.power_kwc",
      "installation.total_power_kwc",
      "hardware.kwc",
      "power_kwc",
      "puissance_kwc",
      "total_power_kwc",
    ]),
  };
}

export function normalizeQuoteFinancialReference(quote = {}) {
  return {
    productionAnnualKwh: firstPathNumber(quote, [
      "productionAnnualKwh",
      "production_annual_kwh",
      "annual_production_kwh",
      "technical_snapshot_summary.production_annual_kwh",
      "technical_snapshot_summary.annual_production_kwh",
      "production.annual_kwh",
      "energy.production_kwh",
    ]),
    capexTtcEur: firstPathNumber(quote, [
      "capexTtcEur",
      "capex_ttc",
      "installation_cost_ttc",
      "total_ttc",
      "totals.ttc",
      "totals.total_ttc",
      "finance.capex_ttc",
    ]),
    aidsTotalEur: firstPathNumber(quote, [
      "aidsTotalEur",
      "aides_total_eur",
      "aids_total_eur",
      "prime_eur",
      "totals.aides_total_eur",
      "finance.aides_total_eur",
      "finance.prime_eur",
    ]),
    powerKwc: firstPathNumber(quote, [
      "powerKwc",
      "power_kwc",
      "puissance_kwc",
      "total_power_kwc",
      "technical_snapshot_summary.power_kwc",
      "technical_snapshot_summary.total_power_kwc",
      "installation.puissance_kwc",
    ]),
  };
}

function compareValue(key, scenarioValue, quoteValue, options = {}) {
  const check = CHECKS[key];
  const normalizedScenarioValue = check.exactMoney ? money2(scenarioValue) : asNumber(scenarioValue);
  const normalizedQuoteValue = check.exactMoney ? money2(quoteValue) : asNumber(quoteValue);

  if (check.optionalWhenBothMissing && normalizedScenarioValue == null && normalizedQuoteValue == null) {
    return {
      key,
      ok: true,
      skipped: true,
      reason: "both_missing",
      label: check.label,
      unit: check.unit,
    };
  }

  if (normalizedScenarioValue == null || normalizedQuoteValue == null) {
    return {
      key,
      ok: false,
      code: normalizedScenarioValue == null ? `MISSING_SCENARIO_${key}` : `MISSING_QUOTE_${key}`,
      label: check.label,
      unit: check.unit,
      scenarioValue: normalizedScenarioValue,
      quoteValue: normalizedQuoteValue,
      tolerance: check.tolerance,
    };
  }

  const diff = Math.abs(normalizedQuoteValue - normalizedScenarioValue);
  const tolerance = options.tolerances?.[key] ?? check.tolerance;
  const ok = diff <= tolerance;

  return {
    key,
    ok,
    code: ok ? null : `SCENARIO_QUOTE_${key}_MISMATCH`,
    label: check.label,
    unit: check.unit,
    scenarioValue: normalizedScenarioValue,
    quoteValue: normalizedQuoteValue,
    diff,
    tolerance,
  };
}

export function validateScenarioQuoteCoherence(scenarioReference, quoteReference, options = {}) {
  const scenario = normalizeScenarioFinancialReference(scenarioReference);
  const quote = normalizeQuoteFinancialReference(quoteReference);
  const checks = Object.keys(CHECKS).map((key) => compareValue(key, scenario[key], quote[key], options));
  const errors = checks.filter((check) => !check.ok);

  return {
    ok: errors.length === 0,
    code: errors.length === 0 ? null : "SCENARIO_QUOTE_COHERENCE_BLOCKED",
    checks,
    errors,
  };
}

export function buildScenarioQuoteCoherenceError(validation) {
  const err = new Error("Creation du devis bloquee: incoherence entre le scenario financier verrouille et le devis.");
  err.name = "ScenarioQuoteCoherenceError";
  err.code = "SCENARIO_QUOTE_COHERENCE_BLOCKED";
  err.statusCode = 409;
  err.details = validation.errors;
  return err;
}

