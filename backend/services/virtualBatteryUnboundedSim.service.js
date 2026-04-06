/**
 * Simulation batterie virtuelle sans plafond de capacité (P2).
 * Même logique que simulateVirtualBattery8760 mais room = illimité,
 * pour en déduire required_capacity_kwh = max(SOC) sans modifier virtualBattery8760.service.js (P1).
 */

const HOURS_PER_YEAR = 8760;
/** Upper bound numérique « infini » pour la chambre disponible (pas un palier métier). */
const UNBOUNDED_ROOM = Number.MAX_SAFE_INTEGER;

/**
 * @param {{ pv_hourly: number[], conso_hourly: number[] }} opts
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   required_capacity_kwh: number,
 *   virtual_battery_total_charged_kwh: number,
 *   virtual_battery_total_discharged_kwh: number,
 *   virtual_battery_overflow_export_kwh: number,
 *   virtual_battery_hourly_credit_balance_kwh: number[],
 *   virtual_battery_hourly_discharge_kwh: number[],
 * }}
 */
export function simulateVirtualBattery8760Unbounded({ pv_hourly, conso_hourly }) {
  if (!Array.isArray(pv_hourly) || pv_hourly.length !== HOURS_PER_YEAR) {
    return { ok: false, reason: "INVALID_PV_HOURLY" };
  }
  if (!Array.isArray(conso_hourly) || conso_hourly.length !== HOURS_PER_YEAR) {
    return { ok: false, reason: "INVALID_CONSO_HOURLY" };
  }

  const creditRatio = 1;
  let SOC = 0;
  let maxSoc = 0;
  const hourlyCreditBalance = [];
  const hourlyDischarge = [];
  let totalCharged = 0;
  let totalDischarged = 0;
  let totalOverflow = 0;

  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const pv = Number(pv_hourly[h]) || 0;
    const load = Number(conso_hourly[h]) || 0;
    const direct = Math.min(pv, load);

    let chargeH = 0;
    let dischargeH = 0;
    let overflowH = 0;

    if (pv >= load) {
      const rawSurplus = pv - load;
      const splittable = rawSurplus * creditRatio;
      const rejectRatio = rawSurplus * (1 - creditRatio);
      const room = UNBOUNDED_ROOM;
      chargeH = Math.min(splittable, room);
      overflowH = rejectRatio + (splittable - chargeH);
      SOC += chargeH;
    } else {
      const need = load - pv;
      dischargeH = Math.min(need, SOC);
      SOC -= dischargeH;
    }

    totalCharged += chargeH;
    totalDischarged += dischargeH;
    totalOverflow += overflowH;
    hourlyCreditBalance.push(Math.round(SOC * 1000) / 1000);
    hourlyDischarge.push(Math.round(dischargeH * 1000) / 1000);
    if (direct) void direct;
    maxSoc = Math.max(maxSoc, SOC);
  }

  const required_capacity_kwh = Math.round(maxSoc * 1000) / 1000;

  return {
    ok: true,
    required_capacity_kwh,
    virtual_battery_total_charged_kwh: Math.round(totalCharged * 1000) / 1000,
    virtual_battery_total_discharged_kwh: Math.round(totalDischarged * 1000) / 1000,
    virtual_battery_overflow_export_kwh: Math.round(totalOverflow * 1000) / 1000,
    virtual_battery_hourly_credit_balance_kwh: hourlyCreditBalance,
    virtual_battery_hourly_discharge_kwh: hourlyDischarge,
  };
}
