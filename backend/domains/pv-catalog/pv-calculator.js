const PANEL_POWER_KWC = 0.425;
const PANEL_AREA_M2 = 1.95;
const ROOF_USAGE_FACTOR = 0.82;
const SELF_CONSUMPTION_MIN = 0.28;
const SELF_CONSUMPTION_MAX = 0.82;
const ELECTRICITY_PRICE_EUR_KWH = 0.25;
const INSTALLED_COST_EUR_KWC = 2200;

const ORIENTATION_FACTOR = {
  S: 1,
  SE: 0.96,
  SW: 0.96,
  E: 0.86,
  W: 0.86,
  NE: 0.72,
  NW: 0.72,
  N: 0.58,
};

const TILT_FACTOR = {
  0: 0.9,
  15: 0.96,
  30: 1,
  45: 0.97,
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 0) {
  const f = 10 ** digits;
  return Math.round(num(value) * f) / f;
}

export function normalizeFrenchPostalCode(postalCode) {
  const raw = String(postalCode ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 2 ? digits.slice(0, 5).padEnd(5, "0") : "";
}

export function estimatePvgisYieldKwhPerKwc(postalCode) {
  const pc = normalizeFrenchPostalCode(postalCode);
  if (!pc) return 1120;
  const dept = pc.slice(0, 2);
  if (["59", "62", "80", "76", "02", "08"].includes(dept)) return 960;
  if (["14", "27", "50", "51", "54", "55", "57", "60", "61", "67", "68", "75", "77", "78", "91", "92", "93", "94", "95"].includes(dept)) return 1010;
  if (["18", "21", "25", "28", "35", "36", "37", "39", "41", "44", "45", "49", "52", "53", "56", "58", "70", "71", "72", "79", "85", "86", "88", "89", "90"].includes(dept)) return 1090;
  if (["01", "03", "07", "16", "17", "19", "23", "24", "26", "33", "38", "42", "43", "46", "63", "69", "73", "74", "87"].includes(dept)) return 1180;
  if (["09", "11", "12", "13", "2A", "2B", "30", "31", "32", "34", "40", "47", "48", "64", "65", "66", "81", "82", "83", "84"].includes(dept)) return 1320;
  if (pc.startsWith("20")) return 1450;
  return 1120;
}

export function estimateQuickPv(input = {}) {
  const roofAreaM2 = Math.max(0, num(input.roofAreaM2 ?? input.roof_area_m2));
  const orientation = String(input.orientation ?? "S").toUpperCase();
  const tiltDeg = String(input.tiltDeg ?? input.inclinationDeg ?? 30);
  const postalCode = normalizeFrenchPostalCode(input.postalCode ?? input.postal_code);
  const annualConsumptionKwh = Math.max(0, num(input.annualConsumptionKwh ?? input.consumption_annual_kwh, 5000));

  const usableAreaM2 = roofAreaM2 * ROOF_USAGE_FACTOR;
  const panelCount = Math.floor(usableAreaM2 / PANEL_AREA_M2);
  const installablePowerKwc = round(panelCount * PANEL_POWER_KWC, 2);
  const baseYield = estimatePvgisYieldKwhPerKwc(postalCode);
  const orientationFactor = ORIENTATION_FACTOR[orientation] ?? ORIENTATION_FACTOR.S;
  const tiltFactor = TILT_FACTOR[tiltDeg] ?? TILT_FACTOR["30"];
  const annualProductionKwh = Math.max(0, Math.round(installablePowerKwc * baseYield * orientationFactor * tiltFactor));

  const productionToConsumptionRatio = annualConsumptionKwh > 0 ? annualProductionKwh / annualConsumptionKwh : 0;
  const autoconsumptionRate = annualProductionKwh > 0
    ? Math.min(SELF_CONSUMPTION_MAX, Math.max(SELF_CONSUMPTION_MIN, 0.72 - productionToConsumptionRatio * 0.16))
    : 0;
  const selfConsumedKwh = Math.min(annualConsumptionKwh, annualProductionKwh * autoconsumptionRate);
  const annualSavingsEur = Math.round(selfConsumedKwh * ELECTRICITY_PRICE_EUR_KWH);
  const investmentEur = Math.round(installablePowerKwc * INSTALLED_COST_EUR_KWC);
  const paybackYears = annualSavingsEur > 0 ? round(investmentEur / annualSavingsEur, 1) : null;

  return {
    inputs: {
      roof_area_m2: roofAreaM2,
      orientation,
      tilt_deg: Number(tiltDeg),
      postal_code: postalCode,
      annual_consumption_kwh: annualConsumptionKwh,
    },
    results: {
      usable_area_m2: round(usableAreaM2, 1),
      panel_count: panelCount,
      installable_power_kwc: installablePowerKwc,
      annual_production_kwh: annualProductionKwh,
      autoconsumption_rate_pct: round(autoconsumptionRate * 100, 1),
      annual_savings_eur: annualSavingsEur,
      indicative_payback_years: paybackYears,
    },
    assumptions: {
      panel_power_kwc: PANEL_POWER_KWC,
      panel_area_m2: PANEL_AREA_M2,
      pvgis_yield_kwh_kwc: baseYield,
      orientation_factor: orientationFactor,
      tilt_factor: tiltFactor,
      electricity_price_eur_kwh: ELECTRICITY_PRICE_EUR_KWH,
      installed_cost_eur_kwc: INSTALLED_COST_EUR_KWC,
      source: "deterministic-postal-pvgis-zone-v1",
    },
    computed_at: new Date().toISOString(),
  };
}
