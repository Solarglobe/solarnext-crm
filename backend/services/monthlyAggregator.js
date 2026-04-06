// ======================================================================
// SMARTPITCH — MONTHLY AGGREGATOR PRO (Solarglobe 2025)
// Corrigé & amélioré :
//  - Ajout import_kwh mensuel
//  - Support batterie via battSummary
//  - auto/surplus réellement calculés (8760h)
//  - Compatible avec scenarioService.js v2025
// ======================================================================

/**
 * Agrège production / consommation / autoconsommation / surplus / import par mois
 * @param {number[]} prodHourly      Profil PV 8760h (après scaling kWc)
 * @param {number[]} consoHourly     Profil conso pilotée 8760h
 * @param {Object|null} battSummary  Si batterie présente : auto/surplus réels
 * @returns {Array} 12 objets {prod_kwh, conso_kwh, auto_kwh, surplus_kwh, import_kwh, auto_pct}
 */
export function aggregateMonthly(prodHourly, consoHourly, battSummary = null) {

  // -------------------------------------------------------------------
  // 1. VALIDATIONS
  // -------------------------------------------------------------------
  if (!Array.isArray(prodHourly) || prodHourly.length !== 8760) {
    throw new Error("aggregateMonthly: prodHourly doit être un tableau 8760h.");
  }
  if (!Array.isArray(consoHourly) || consoHourly.length !== 8760) {
    throw new Error("aggregateMonthly: consoHourly doit être un tableau 8760h.");
  }

  let autoHourly = null;
  let surplusHourly = null;
  const battDischargeHourly = battSummary?.batt_discharge_hourly;

  // Si batterie → utiliser auto/surplus réels provenant de simulateBattery8760()
  if (battSummary && battSummary.auto_hourly && battSummary.surplus_hourly) {
    autoHourly = battSummary.auto_hourly;
    surplusHourly = battSummary.surplus_hourly;
  }

  // Sinon → calcul direct heure par heure
  else {
    autoHourly = [];
    surplusHourly = [];

    for (let i = 0; i < 8760; i++) {
      const a = Math.min(prodHourly[i], consoHourly[i]);
      const s = Math.max(0, prodHourly[i] - consoHourly[i]);
      autoHourly.push(a);
      surplusHourly.push(s);
    }
  }

  // -------------------------------------------------------------------
  // 2. Définitions des mois
  // -------------------------------------------------------------------
  const daysPerMonth = [31,28,31,30,31,30,31,31,30,31,30,31];

  const months = Array.from({ length: 12 }, () => ({
    prod_kwh: 0,
    conso_kwh: 0,
    auto_kwh: 0,
    surplus_kwh: 0,
    import_kwh: 0,
    batt_kwh: 0
  }));

  // -------------------------------------------------------------------
  // 3. BOUCLE 8760 → mensuel
  // -------------------------------------------------------------------
  let index = 0;

  for (let m = 0; m < 12; m++) {
    const days = daysPerMonth[m];
    const hours = days * 24;

    for (let h = 0; h < hours; h++) {
      const pv = Math.max(0, prodHourly[index]);
      const load = Math.max(0, consoHourly[index]);

      const a = autoHourly[index];
      const s = surplusHourly[index];
      const imp = Math.max(0, load - a);
      const battH = Array.isArray(battDischargeHourly) && battDischargeHourly.length === 8760
        ? Math.max(0, battDischargeHourly[index] ?? 0)
        : 0;

      months[m].prod_kwh    += pv;
      months[m].conso_kwh   += load;
      months[m].auto_kwh    += a;
      months[m].surplus_kwh += s;
      months[m].import_kwh  += imp;
      months[m].batt_kwh    += battH;

      index++;
    }
  }

  // -------------------------------------------------------------------
  // 4. FINALISATION
  // -------------------------------------------------------------------
  if (process.env.NODE_ENV !== "production" && process.env.DEBUG_CALC_TRACE === "1") {
    const sumPv = months.reduce((a, m) => a + m.prod_kwh, 0);
    const sumConso = months.reduce((a, m) => a + m.conso_kwh, 0);
    const sumAuto = months.reduce((a, m) => a + m.auto_kwh, 0);
    const sumSurplus = months.reduce((a, m) => a + m.surplus_kwh, 0);
    const sumImport = months.reduce((a, m) => a + m.import_kwh, 0);
    const identityConso = Math.abs((sumAuto + sumImport) - sumConso);
    const identityProd = Math.abs((sumAuto + sumSurplus) - sumPv);
    const pvMin = Math.min(...months.map(m => m.prod_kwh));
    const pvMax = Math.max(...months.map(m => m.prod_kwh));
    const consoMin = Math.min(...months.map(m => m.conso_kwh));
    const consoMax = Math.max(...months.map(m => m.conso_kwh));
    console.log(JSON.stringify({
      tag: "TRACE_AGG_MONTHLY",
      pvHourly_length: prodHourly.length,
      consoHourly_length: consoHourly.length,
      sumPv,
      sumConso,
      sumAuto,
      sumImport,
      sumSurplus,
      identity_abs_auto_plus_import_minus_conso: identityConso,
      identity_abs_auto_plus_surplus_minus_pv: identityProd,
      pv_min: pvMin,
      pv_max: pvMax,
      conso_min: consoMin,
      conso_max: consoMax,
    }));
  }
  return months.map(m => ({
    prod_kwh: Math.round(m.prod_kwh),
    conso_kwh: Math.round(m.conso_kwh),
    auto_kwh: Math.round(m.auto_kwh),
    surplus_kwh: Math.round(m.surplus_kwh),
    import_kwh: Math.round(m.import_kwh),
    batt_kwh: Math.round(m.batt_kwh),
    auto_pct: m.prod_kwh > 0 ? Math.round((m.auto_kwh / m.prod_kwh) * 100) : 0
  }));
}
