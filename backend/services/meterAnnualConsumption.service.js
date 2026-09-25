const kwhOrNull = (raw) => {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Annual denominator for the active input mode, before future equipment changes. */
export function resolveMeterAnnualConsumptionKwh({ meter, profileAnnualKwh, monthlyKwh }) {
  const mode = String(meter?.consumption_mode || "ANNUAL").toUpperCase();
  if (mode === "MONTHLY") {
    if (Array.isArray(monthlyKwh) && monthlyKwh.length === 12) {
      const months = monthlyKwh.map(kwhOrNull);
      if (months.every((n) => n != null)) return months.reduce((sum, n) => sum + n, 0);
    }
    return kwhOrNull(meter?.consumption_annual_calculated_kwh);
  }
  if (mode === "PDL" || mode === "HOURLY") {
    return kwhOrNull(profileAnnualKwh)
      ?? kwhOrNull(meter?.consumption_annual_calculated_kwh)
      ?? kwhOrNull(meter?.consumption_annual_kwh);
  }
  return kwhOrNull(meter?.consumption_annual_kwh);
}
