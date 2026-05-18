const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const HOURS_PER_DAY = 24;
const HOURS_PER_YEAR = 8760;
const MONTHLY_ANNUAL_TOLERANCE_PCT = 0.1;
const HOURLY_MONTHLY_TOLERANCE_PCT = 0.01;
const EPSILON_WH = 1e-6;

const MONTHLY_SEASONAL_CONSUMPTION_WEIGHTS = Object.freeze([
  1.24, 1.12, 1.04, 0.92, 0.84, 0.78, 0.76, 0.78, 0.88, 0.98, 1.10, 1.26,
]);

const RESIDENTIAL_HOURLY_WEIGHTS = Object.freeze([
  0.62, 0.56, 0.52, 0.50, 0.54, 0.72, 0.98, 1.18,
  1.06, 0.92, 0.86, 0.88, 0.94, 0.90, 0.86, 0.92,
  1.08, 1.32, 1.48, 1.42, 1.24, 1.02, 0.84, 0.70,
]);

const COMMERCIAL_HOURLY_WEIGHTS = Object.freeze([
  0.22, 0.20, 0.20, 0.20, 0.22, 0.28, 0.50, 0.84,
  1.20, 1.34, 1.42, 1.48, 1.44, 1.42, 1.36, 1.26,
  1.08, 0.78, 0.48, 0.34, 0.28, 0.24, 0.22, 0.22,
]);

const SUN_WINDOWS = Object.freeze([
  [8, 17], [7, 18], [6, 19], [6, 20], [5, 21], [5, 22],
  [5, 22], [6, 21], [7, 20], [7, 19], [8, 17], [8, 16],
]);

function sum(values) {
  return values.reduce((total, value) => total + sanitizeEnergy(value), 0);
}

function sanitizeEnergy(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function assertFiniteNonNegative(value, name) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return numberValue;
}

function assertArrayLength(values, expectedLength, name) {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    throw new TypeError(`${name} must be an array of ${expectedLength} numbers`);
  }
}

function toWh(value, unit, name) {
  const safeValue = assertFiniteNonNegative(value, name);
  if (unit === "kWh") return safeValue * 1000;
  if (unit === "Wh") return safeValue;
  throw new TypeError(`${name} unit must be "Wh" or "kWh"`);
}

function normalizeMonthlyProduction(input = {}) {
  if (Array.isArray(input.monthlyProductionWh)) {
    assertArrayLength(input.monthlyProductionWh, 12, "monthlyProductionWh");
    return input.monthlyProductionWh.map((value, index) => assertFiniteNonNegative(value, `monthlyProductionWh[${index}]`));
  }

  const monthlyKwh = input.monthlyProductionKwh ?? input.productionMensuelleKwh;
  if (Array.isArray(monthlyKwh)) {
    assertArrayLength(monthlyKwh, 12, "monthlyProductionKwh");
    return monthlyKwh.map((value, index) => toWh(value, "kWh", `monthlyProductionKwh[${index}]`));
  }

  throw new TypeError("monthlyProductionKwh or monthlyProductionWh is required");
}

function normalizeAnnualProductionWh(input = {}, monthlyProductionWh) {
  if (input.annualProductionWh != null) {
    return toWh(input.annualProductionWh, "Wh", "annualProductionWh");
  }
  if (input.annualProductionKwh != null || input.productionAnnuelleKwh != null) {
    return toWh(input.annualProductionKwh ?? input.productionAnnuelleKwh, "kWh", "annualProductionKwh");
  }
  return sum(monthlyProductionWh);
}

function relativeDiffPct(left, right) {
  if (right === 0) return left === 0 ? 0 : Infinity;
  return (Math.abs(left - right) / Math.abs(right)) * 100;
}

function monthHourRange(monthIndex) {
  let start = 0;
  for (let month = 0; month < monthIndex; month++) {
    start += DAYS_IN_MONTH[month] * HOURS_PER_DAY;
  }
  const end = start + DAYS_IN_MONTH[monthIndex] * HOURS_PER_DAY;
  return { start, end };
}

function buildSolarDayWeights(monthIndex) {
  const [startHour, endHour] = SUN_WINDOWS[monthIndex];
  const weights = new Array(HOURS_PER_DAY).fill(0);
  const duration = endHour - startHour;

  for (let hour = startHour; hour <= endHour; hour++) {
    const position = (hour - startHour + 0.5) / Math.max(duration + 1, 1);
    const bell = Math.sin(Math.PI * position);
    weights[hour] = bell > 0 ? bell : 0;
  }

  const total = sum(weights);
  return total > 0 ? weights.map((value) => value / total) : weights;
}

function distributeMonthlyProductionWh(monthlyProductionWh, peakPowerKwc) {
  const peakWhPerHour = assertFiniteNonNegative(peakPowerKwc, "peakPowerKwc") * 1000;
  const hourly = [];

  for (let month = 0; month < 12; month++) {
    const monthlyWh = monthlyProductionWh[month];
    const hoursInMonth = DAYS_IN_MONTH[month] * HOURS_PER_DAY;

    if (monthlyWh === 0) {
      hourly.push(...new Array(hoursInMonth).fill(0));
      continue;
    }

    if (peakWhPerHour <= 0) {
      throw new RangeError("peakPowerKwc must be positive when monthly production is greater than zero");
    }

    if (monthlyWh > peakWhPerHour * hoursInMonth + EPSILON_WH) {
      throw new RangeError(`monthlyProductionWh[${month}] exceeds the physical monthly maximum for peakPowerKwc`);
    }

    const dayWeights = buildSolarDayWeights(month);
    const daylightWeightSum = sum(dayWeights);
    const daylightHoursPerMonth = dayWeights.filter((value) => value > 0).length * DAYS_IN_MONTH[month];
    const maxDaylightProduction = peakWhPerHour * daylightHoursPerMonth;
    const useFlatDaylight = monthlyWh > maxDaylightProduction + EPSILON_WH;
    const dailyWh = monthlyWh / DAYS_IN_MONTH[month];

    for (let day = 0; day < DAYS_IN_MONTH[month]; day++) {
      if (useFlatDaylight) {
        const baseWh = monthlyWh / hoursInMonth;
        for (let hour = 0; hour < HOURS_PER_DAY; hour++) hourly.push(baseWh);
        continue;
      }

      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        hourly.push(dailyWh * (daylightWeightSum > 0 ? dayWeights[hour] : 0));
      }
    }
  }

  return closeRoundingDriftByMonth(hourly, monthlyProductionWh, peakWhPerHour);
}

function closeRoundingDriftByMonth(hourlyWh, monthlyWh, peakWhPerHour = Infinity) {
  const output = hourlyWh.slice();
  for (let month = 0; month < 12; month++) {
    const { start, end } = monthHourRange(month);
    const monthSum = sum(output.slice(start, end));
    const drift = monthlyWh[month] - monthSum;
    if (Math.abs(drift) <= EPSILON_WH) continue;

    let targetIndex = start;
    for (let index = start; index < end; index++) {
      if (output[index] > 0 || drift > 0) {
        targetIndex = index;
        break;
      }
    }
    const corrected = output[targetIndex] + drift;
    output[targetIndex] = Math.min(Math.max(corrected, 0), peakWhPerHour);
  }
  return output;
}

function buildMonthlyConsumptionWh(input = {}) {
  if (Array.isArray(input.monthlyConsumptionWh)) {
    assertArrayLength(input.monthlyConsumptionWh, 12, "monthlyConsumptionWh");
    return input.monthlyConsumptionWh.map((value, index) => assertFiniteNonNegative(value, `monthlyConsumptionWh[${index}]`));
  }

  if (Array.isArray(input.monthlyConsumptionKwh)) {
    assertArrayLength(input.monthlyConsumptionKwh, 12, "monthlyConsumptionKwh");
    return input.monthlyConsumptionKwh.map((value, index) => toWh(value, "kWh", `monthlyConsumptionKwh[${index}]`));
  }

  const annualConsumptionWh = toWh(input.annualConsumptionKwh ?? input.consumptionAnnualKwh ?? 0, "kWh", "annualConsumptionKwh");
  const weightSum = sum(MONTHLY_SEASONAL_CONSUMPTION_WEIGHTS);
  return MONTHLY_SEASONAL_CONSUMPTION_WEIGHTS.map((weight) => (annualConsumptionWh * weight) / weightSum);
}

function buildConsumptionHourlyWh(input = {}) {
  if (Array.isArray(input.consumptionHourlyWh)) {
    assertArrayLength(input.consumptionHourlyWh, HOURS_PER_YEAR, "consumptionHourlyWh");
    return input.consumptionHourlyWh.map((value, index) => assertFiniteNonNegative(value, `consumptionHourlyWh[${index}]`));
  }

  if (Array.isArray(input.consumptionHourlyKwh)) {
    assertArrayLength(input.consumptionHourlyKwh, HOURS_PER_YEAR, "consumptionHourlyKwh");
    return input.consumptionHourlyKwh.map((value, index) => toWh(value, "kWh", `consumptionHourlyKwh[${index}]`));
  }

  const monthlyConsumptionWh = buildMonthlyConsumptionWh(input);
  const hourlyShape = input.consumptionProfile === "commercial" ? COMMERCIAL_HOURLY_WEIGHTS : RESIDENTIAL_HOURLY_WEIGHTS;
  const hourlyShapeSum = sum(hourlyShape);
  const hourly = [];

  for (let month = 0; month < 12; month++) {
    const dailyWh = monthlyConsumptionWh[month] / DAYS_IN_MONTH[month];
    for (let day = 0; day < DAYS_IN_MONTH[month]; day++) {
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        hourly.push(dailyWh * hourlyShape[hour] / hourlyShapeSum);
      }
    }
  }

  return closeRoundingDriftByMonth(hourly, monthlyConsumptionWh);
}

export function calculateEnergy8760(input = {}) {
  const peakPowerKwc = assertFiniteNonNegative(input.peakPowerKwc ?? input.puissanceCreteKwc, "peakPowerKwc");
  const monthlyProductionWh = normalizeMonthlyProduction(input);
  const annualProductionWh = normalizeAnnualProductionWh(input, monthlyProductionWh);
  const productionHourlyWh = distributeMonthlyProductionWh(monthlyProductionWh, peakPowerKwc);
  const consumptionHourlyWh = buildConsumptionHourlyWh(input);

  const injectionHourlyWh = new Array(HOURS_PER_YEAR);
  const selfConsumptionHourlyWh = new Array(HOURS_PER_YEAR);

  for (let index = 0; index < HOURS_PER_YEAR; index++) {
    const productionWh = productionHourlyWh[index];
    const consumptionWh = consumptionHourlyWh[index];
    injectionHourlyWh[index] = Math.max(0, productionWh - consumptionWh);
    selfConsumptionHourlyWh[index] = Math.min(productionWh, consumptionWh);
  }

  const annualConsumptionWh = sum(consumptionHourlyWh);
  const annualSelfConsumptionWh = sum(selfConsumptionHourlyWh);
  const result = {
    productionHourlyWh,
    consumptionHourlyWh,
    injectionHourlyWh,
    selfConsumptionHourlyWh,
    productionMonthlyWh: monthlyProductionWh.slice(),
    consumptionMonthlyWh: aggregateHourlyByMonth(consumptionHourlyWh),
    productionAnnualWh: annualProductionWh,
    consumptionAnnualWh: annualConsumptionWh,
    injectionAnnualWh: sum(injectionHourlyWh),
    selfConsumptionAnnualWh: annualSelfConsumptionWh,
    selfConsumptionRate: annualProductionWh > 0 ? annualSelfConsumptionWh / annualProductionWh : 0,
    selfSufficiencyRate: annualConsumptionWh > 0 ? annualSelfConsumptionWh / annualConsumptionWh : 0,
    coherence: null,
  };

  result.coherence = validateEnergyResult(result, { peakPowerKwc });
  return result;
}

export function aggregateHourlyByMonth(hourlyWh) {
  assertArrayLength(hourlyWh, HOURS_PER_YEAR, "hourlyWh");
  return DAYS_IN_MONTH.map((_, month) => {
    const { start, end } = monthHourRange(month);
    return sum(hourlyWh.slice(start, end));
  });
}

export function validateEnergyResult(result, { peakPowerKwc } = {}) {
  const productionHourlyWh = result?.productionHourlyWh;
  const productionMonthlyWh = result?.productionMonthlyWh;
  const productionAnnualWh = sanitizeEnergy(result?.productionAnnualWh);
  const peakWhPerHour = sanitizeEnergy(peakPowerKwc) * 1000;
  const errors = [];

  if (!Array.isArray(productionHourlyWh) || productionHourlyWh.length !== HOURS_PER_YEAR) {
    errors.push(`productionHourlyWh must contain ${HOURS_PER_YEAR} values`);
  }
  if (!Array.isArray(productionMonthlyWh) || productionMonthlyWh.length !== 12) {
    errors.push("productionMonthlyWh must contain 12 values");
  }
  if (errors.length > 0) return { ok: false, errors };

  const monthlySumWh = sum(productionMonthlyWh);
  const monthlyAnnualDiffPct = relativeDiffPct(monthlySumWh, productionAnnualWh);
  if (monthlyAnnualDiffPct > MONTHLY_ANNUAL_TOLERANCE_PCT) {
    errors.push(`monthly/annual production mismatch: ${monthlyAnnualDiffPct}%`);
  }

  const aggregatedMonthlyWh = aggregateHourlyByMonth(productionHourlyWh);
  const hourlyMonthly = aggregatedMonthlyWh.map((hourlySumWh, month) => {
    const declaredWh = sanitizeEnergy(productionMonthlyWh[month]);
    const diffPct = relativeDiffPct(hourlySumWh, declaredWh);
    const ok = diffPct <= HOURLY_MONTHLY_TOLERANCE_PCT;
    if (!ok) errors.push(`hourly/monthly production mismatch on month ${month + 1}: ${diffPct}%`);
    return { month: month + 1, hourlySumWh, declaredWh, diffPct, ok };
  });

  let maxProductionHourlyWh = 0;
  let negativeProductionCount = 0;
  let physicalExceedanceCount = 0;
  for (const value of productionHourlyWh) {
    if (value < -EPSILON_WH) negativeProductionCount++;
    if (value > maxProductionHourlyWh) maxProductionHourlyWh = value;
    if (peakWhPerHour > 0 && value > peakWhPerHour + EPSILON_WH) physicalExceedanceCount++;
  }

  if (negativeProductionCount > 0) {
    errors.push(`negative hourly production: ${negativeProductionCount} value(s)`);
  }
  if (physicalExceedanceCount > 0) {
    errors.push(`physical peak exceeded: ${physicalExceedanceCount} hour(s) above ${peakWhPerHour} Wh`);
  }

  return {
    ok: errors.length === 0,
    errors,
    monthlyAnnual: { monthlySumWh, annualWh: productionAnnualWh, diffPct: monthlyAnnualDiffPct },
    hourlyMonthly,
    negativeProductionCount,
    maxProductionHourlyWh,
    peakWhPerHour,
    physicalExceedanceCount,
  };
}

export {
  DAYS_IN_MONTH,
  HOURS_PER_YEAR,
  MONTHLY_ANNUAL_TOLERANCE_PCT,
  HOURLY_MONTHLY_TOLERANCE_PCT,
};
