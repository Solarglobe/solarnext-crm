export const URBAN_SOLAR_VIRTUAL_BATTERY_TARIFFS_2026_08_01 = Object.freeze({
  provider: "URBAN_SOLAR",
  effectiveDate: "2026-08-01",
  sourceLabel: "Urban Solar Stockage Virtuel - particuliers - tarifs applicables au 1er aout 2026",
  oneTimeSetupFeeTtc: 299,
  storageSubscriptionEurPerKwcMonthHt: 1,
  autoproducerContributionEurPerYearHt: 9.84,
  supplierSubscriptionIncludesAutoproducerContribution: true,
  restitutionTtcPerKwh: Object.freeze({
    base: 0.111,
    hp: 0.1122,
    hc: 0.0945,
  }),
  electricityTtcPerKwh: Object.freeze({
    baseByKva: Object.freeze({
      3: 0.2001,
      6: 0.2001,
      9: 0.1985,
      12: 0.1985,
      15: 0.1985,
      18: 0.1985,
      24: 0.1985,
      30: 0.1985,
      36: 0.1985,
    }),
    hp: 0.2142,
    hc: 0.1589,
  }),
  supplierSubscriptionTtcPerMonth: Object.freeze({
    base: Object.freeze({
      3: 13.31,
      6: 17.08,
      9: 21.15,
      12: 25.07,
      15: 28.75,
      18: 32.54,
      24: 40.62,
      30: 48.05,
      36: 55.54,
    }),
    hphc: Object.freeze({
      3: 17.31,
      6: 17.31,
      9: 21.48,
      12: 26.09,
      15: 30.88,
      18: 35.68,
      24: 45.27,
      30: 54.86,
      36: 64.45,
    }),
  }),
});

export const URBAN_SOLAR_KVA_STEPS = Object.freeze([3, 6, 9, 12, 15, 18, 24, 30, 36]);

export function urbanSolarNearestKva(meterKva) {
  const n = Math.max(3, Math.min(36, Math.round(Number(meterKva) || 0)));
  return URBAN_SOLAR_KVA_STEPS.reduce((prev, curr) =>
    Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev
  );
}

