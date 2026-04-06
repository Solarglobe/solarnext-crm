// ======================================================================
// SMARTPITCH — Batterie virtuelle 8760h (compte kWh contractuel, pas de physique)
// ======================================================================

const HOURS_PER_YEAR = 8760;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Résout la capacité stockable virtuelle (kWh max du compteur).
 * Ordre : capacity_kwh → virtual_capacity_kwh → credit_cap_kwh (toutes doivent être
 * explicitement renseignées dans la config / payload — aucun défaut métier ici).
 * @param {object} config - virtual_battery_input
 * @returns {number|null}
 */
export function resolveVirtualBatteryCapacityKwh(config) {
  if (!config || typeof config !== "object") return null;
  const cap = config.capacity_kwh ?? config.virtual_capacity_kwh ?? config.credit_cap_kwh;
  if (cap == null || !Number.isFinite(Number(cap)) || Number(cap) <= 0) return null;
  return Number(cap);
}

/**
 * Agrège import facturable et flux virtuels par mois (12 lignes).
 * @param {number[]} gridImportHourly
 * @param {number[]} chargeHourly
 * @param {number[]} dischargeHourly
 * @param {number[]} socEndHourly - SOC fin d'heure (pour bank_end fin de mois)
 */
export function aggregateVirtualBatteryMonthly(gridImportHourly, chargeHourly, dischargeHourly, socEndHourly) {
  const out = [];
  let idx = 0;
  for (let m = 0; m < 12; m++) {
    const hCount = DAYS_PER_MONTH[m] * 24;
    let billable = 0;
    let credited = 0;
    let used = 0;
    const endIdx = idx + hCount - 1;
    for (let k = 0; k < hCount; k++, idx++) {
      billable += Number(gridImportHourly[idx]) || 0;
      credited += Number(chargeHourly[idx]) || 0;
      used += Number(dischargeHourly[idx]) || 0;
    }
    const bankEnd = socEndHourly[endIdx] != null ? Number(socEndHourly[endIdx]) : 0;
    out.push({
      billable_import: Math.round(billable * 100) / 100,
      credited: Math.round(credited * 100) / 100,
      used_credit: Math.round(used * 100) / 100,
      bank_end: Math.round(bankEnd * 100) / 100,
    });
  }
  return out;
}

/**
 * Simulation heure par heure : crédit surplus jusqu'à capacité, overflow → export ;
 * déficit couvert par déstockage puis réseau. Pas de rendement ni puissance max.
 *
 * @param {{
 *   pv_hourly: number[],
 *   conso_hourly: number[],
 *   config: { capacity_kwh: number, credit_ratio?: number } — credit_ratio est ignoré : P1 = 100 % du surplus éligible au crédit (champ réservé rétrocompat / futur).
 * }} opts
 */
export function simulateVirtualBattery8760({ pv_hourly, conso_hourly, config }) {
  if (!Array.isArray(pv_hourly) || pv_hourly.length !== HOURS_PER_YEAR) {
    return { ok: false, reason: "INVALID_PV_HOURLY" };
  }
  if (!Array.isArray(conso_hourly) || conso_hourly.length !== HOURS_PER_YEAR) {
    return { ok: false, reason: "INVALID_CONSO_HOURLY" };
  }

  const capacity_kwh = resolveVirtualBatteryCapacityKwh(config);
  if (capacity_kwh == null) {
    return { ok: false, reason: "MISSING_VIRTUAL_CAPACITY_KWH" };
  }

  // P1 standard : pas de crédit partiel — config.credit_ratio n’est pas appliqué (anciennes configs sans effet sur la sim).
  const creditRatio = 1;

  let SOC = 0;
  const hourlyCharge = [];
  const hourlyDischarge = [];
  const hourlyOverflowExport = [];
  const hourlyGridImport = [];
  const hourlyCreditBalance = [];
  const autoHourly = [];
  const surplusHourly = [];

  let totalCharged = 0;
  let totalDischarged = 0;
  let totalOverflowExport = 0;
  let totalGridImport = 0;

  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const pv = Number(pv_hourly[h]) || 0;
    const load = Number(conso_hourly[h]) || 0;
    const direct = Math.min(pv, load);

    let chargeH = 0;
    let dischargeH = 0;
    let overflowH = 0;
    let importH = 0;

    if (pv >= load) {
      const rawSurplus = pv - load;
      const splittable = rawSurplus * creditRatio;
      const rejectRatio = rawSurplus * (1 - creditRatio);
      const room = Math.max(0, capacity_kwh - SOC);
      chargeH = Math.min(splittable, room);
      overflowH = rejectRatio + (splittable - chargeH);
      SOC += chargeH;
    } else {
      const need = load - pv;
      dischargeH = Math.min(need, SOC);
      SOC -= dischargeH;
      importH = need - dischargeH;
    }

    const autoH = direct + dischargeH;

    totalCharged += chargeH;
    totalDischarged += dischargeH;
    totalOverflowExport += overflowH;
    totalGridImport += importH;

    hourlyCharge.push(chargeH);
    hourlyDischarge.push(dischargeH);
    hourlyOverflowExport.push(overflowH);
    hourlyGridImport.push(importH);
    hourlyCreditBalance.push(SOC);
    autoHourly.push(autoH);
    surplusHourly.push(overflowH);
  }

  const pvTotal = pv_hourly.reduce((a, b) => a + (Number(b) || 0), 0);
  const loadTotal = conso_hourly.reduce((a, b) => a + (Number(b) || 0), 0);
  const autoTotal = autoHourly.reduce((a, b) => a + b, 0);
  const surplusTotal = surplusHourly.reduce((a, b) => a + b, 0);
  const importTotal = hourlyGridImport.reduce((a, b) => a + b, 0);

  return {
    ok: true,
    virtual_battery_capacity_kwh: capacity_kwh,
    virtual_battery_credit_end_kwh: Math.round(SOC * 1000) / 1000,
    virtual_battery_total_charged_kwh: Math.round(totalCharged * 1000) / 1000,
    virtual_battery_total_discharged_kwh: Math.round(totalDischarged * 1000) / 1000,
    virtual_battery_overflow_export_kwh: Math.round(totalOverflowExport * 1000) / 1000,
    virtual_battery_hourly_charge_kwh: hourlyCharge,
    virtual_battery_hourly_discharge_kwh: hourlyDischarge,
    virtual_battery_hourly_credit_balance_kwh: hourlyCreditBalance,
    virtual_battery_hourly_overflow_export_kwh: hourlyOverflowExport,
    virtual_battery_hourly_grid_import_kwh: hourlyGridImport,
    /** Pour aggregateMonthly (même convention que batterie physique) */
    auto_hourly: autoHourly,
    surplus_hourly: surplusHourly,
    batt_discharge_hourly: hourlyDischarge,
    prod_kwh: Math.round(pvTotal),
    auto_kwh: Math.round(autoTotal),
    surplus_kwh: Math.round(surplusTotal),
    grid_import_kwh: Math.round(importTotal),
    /** Bilans bruts (non arrondis) pour tests */
    _balance: {
      sum_pv: pvTotal,
      sum_load: loadTotal,
      sum_import: importTotal,
      sum_overflow: totalOverflowExport,
      soc_end: SOC,
    },
  };
}

/**
 * Cohérence : Σ(pv) + Σ(import) = Σ(load) + Σ(overflow) + SOC_fin (SOC initial = 0).
 */
export function assertVirtualBatteryAnnualBalance(result, epsKwh = 1) {
  if (!result.ok) return { ok: true, skipped: true };
  const b = result._balance;
  if (!b) return { ok: false, reason: "NO_BALANCE" };
  const left = b.sum_pv + b.sum_import;
  const right = b.sum_load + b.sum_overflow + b.soc_end;
  const delta = Math.abs(left - right);
  const idConso = Math.abs(b.sum_load - (result.auto_kwh + result.grid_import_kwh));
  return {
    ok: delta <= epsKwh && idConso <= epsKwh,
    delta_energy: delta,
    id_conso: idConso,
  };
}
