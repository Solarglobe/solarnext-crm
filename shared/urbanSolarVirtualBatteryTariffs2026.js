export const URBAN_SOLAR_VIRTUAL_BATTERY_TARIFFS_2026_08_01 = Object.freeze({
  id: "URBAN_SOLAR_PARTICULIER_2026_08_01",
  provider: "URBAN_SOLAR",
  effectiveDate: "2026-08-01",
  verifiedAt: "2026-09-15",
  sourceUrls: Object.freeze({
    hphc: "https://www.urbansolarenergy.fr/wp-content/uploads/2026/08/TARIFS-BV-PARTICULIER-HPHC.pdf",
    base: "https://www.urbansolarenergy.fr/wp-content/uploads/2026/08/TARIFS-BV-PARTICULIER-BASE.pdf",
  }),
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
  // Published HTT and TTC are distinct. Invoice with the published TTC directly:
  // note 9 already includes TICFE, CEE and VAT; never add them a second time.
  restitutionHttPerKwh: Object.freeze({ base: 0.0499, hp: 0.0509, hc: 0.0361 }),
  restitutionTaxTreatment: Object.freeze({
    invoicePriceBasis: "PUBLISHED_TTC",
    ceeHtPerKwh: 0.012,
    ceeEffectiveDate: "2026-08-01",
    includesCee: true,
    includesTicfe: true,
    includesVat: true,
    extraCeeChargeTtcPerKwh: 0,
    sourceNote: "9",
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

export const URBAN_SOLAR_TARIFF_EDITIONS = Object.freeze([URBAN_SOLAR_VIRTUAL_BATTERY_TARIFFS_2026_08_01]);

export function urbanSolarTariffReferenceDate(value = null, now = new Date()) {
  const date = value == null || value === ''
    ? new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
    : String(value);
  const timestamp = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0,10) !== date) throw new Error('URBAN_TARIFF_REFERENCE_DATE_INVALID');
  return date;
}

/** Prices are selected by their effective date, independently of credit rules. */
export function resolveUrbanSolarTariffsForDate(referenceDate = null, editions = URBAN_SOLAR_TARIFF_EDITIONS) {
  const date = urbanSolarTariffReferenceDate(referenceDate);
  return [...editions].filter(row => row.effectiveDate <= date).sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ?? null;
}

export const URBAN_SOLAR_KVA_STEPS = Object.freeze([3, 6, 9, 12, 15, 18, 24, 30, 36]);

export function urbanSolarNearestKva(meterKva) {
  const n = Math.max(3, Math.min(36, Math.round(Number(meterKva) || 0)));
  return URBAN_SOLAR_KVA_STEPS.reduce((prev, curr) =>
    Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev
  );
}
