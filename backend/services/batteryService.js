// ======================================================================
// SMARTPITCH — SIMULATION BATTERIE 8760H (paramètres devis uniquement, pas de 7 kWh hardcodé)
// ======================================================================

/**
 * Pass-through sans batterie : auto = min(pv, load), surplus = max(0, pv - load).
 */
function passThroughNoBattery(pv_hourly, conso_hourly) {
  const auto_hourly = [];
  const surplus_hourly = [];
  for (let h = 0; h < 8760; h++) {
    const pv = pv_hourly[h] || 0;
    const load = conso_hourly[h] || 0;
    const direct = Math.min(pv, load);
    const surplus = Math.max(0, pv - load);
    auto_hourly.push(direct);
    surplus_hourly.push(surplus);
  }
  const auto_total = auto_hourly.reduce((a, b) => a + b, 0);
  const surplus_total = surplus_hourly.reduce((a, b) => a + b, 0);
  const pv_total = pv_hourly.reduce((a, b) => a + (b || 0), 0);
  return {
    ok: true,
    passThrough: true,
    pv_hourly,
    conso_hourly,
    auto_hourly,
    surplus_hourly,
    batt_discharge_hourly: Array(8760).fill(0),
    batt_charge_hourly: Array(8760).fill(0),
    battery_soc_hourly: Array(8760).fill(0),
    prod_kwh: Math.round(pv_total),
    auto_kwh: Math.round(auto_total),
    surplus_kwh: Math.round(surplus_total),
    grid_import_kwh: Math.round(conso_hourly.reduce((a, b) => a + (b || 0), 0) - auto_total),
    auto_pct: pv_total > 0 ? Math.round((auto_total / pv_total) * 100) : 0,
  };
}

/**
 * Simule la batterie 8760h. Paramètres uniquement depuis battery (devis / payload).
 * @param {{ pv_hourly: number[], conso_hourly: number[], battery?: object }} opts
 *   battery: { enabled?, capacity_kwh?, roundtrip_efficiency?, max_charge_kw?, max_discharge_kw? }
 * @returns Résultat avec ok/reason si refus, sinon { ok: true, pv_hourly, conso_hourly, auto_hourly, surplus_hourly, ... }
 */
export function simulateBattery8760({
  pv_hourly,
  conso_hourly,
  battery,
}) {
  if (!Array.isArray(pv_hourly) || pv_hourly.length !== 8760) {
    return { ok: false, reason: "INVALID_PV_HOURLY" };
  }
  if (!Array.isArray(conso_hourly) || conso_hourly.length !== 8760) {
    return { ok: false, reason: "INVALID_CONSO_HOURLY" };
  }

  if (!battery || battery.enabled !== true) {
    const pass = passThroughNoBattery(pv_hourly, conso_hourly);
    return { ...pass, ok: false, reason: "NO_BATTERY" };
  }

  const capacity_kwh = battery.capacity_kwh != null ? Number(battery.capacity_kwh) : null;
  if (capacity_kwh == null || capacity_kwh <= 0 || !Number.isFinite(capacity_kwh)) {
    return { ok: false, reason: "MISSING_BATTERY_CAPACITY" };
  }

  const roundtrip = battery.roundtrip_efficiency != null
    ? Math.max(0, Math.min(1, Number(battery.roundtrip_efficiency)))
    : 1;
  const effCh = roundtrip > 0 ? Math.sqrt(roundtrip) : 1;
  const effDis = roundtrip > 0 ? Math.sqrt(roundtrip) : 1;

  const pCh = battery.max_charge_kw != null && Number.isFinite(Number(battery.max_charge_kw))
    ? Math.max(0, Number(battery.max_charge_kw))
    : Infinity;
  const pDis = battery.max_discharge_kw != null && Number.isFinite(Number(battery.max_discharge_kw))
    ? Math.max(0, Number(battery.max_discharge_kw))
    : Infinity;

  const minSOCpct = 10;
  const SOC_min = capacity_kwh * (minSOCpct / 100);
  let SOC = capacity_kwh * 0.45;

  let auto_total = 0;
  let surplus_total = 0;
  let grid_total = 0;
  let charge_in_total = 0;
  let discharge_total = 0;

  const auto_hourly = [];
  const surplus_hourly = [];
  const batt_discharge_hourly = [];
  const batt_charge_hourly = [];
  const battery_soc_hourly = [];

  for (let h = 0; h < 8760; h++) {
    const pv = pv_hourly[h] || 0;
    const load = conso_hourly[h] || 0;

    const direct = Math.min(pv, load);
    let surplus = pv - direct;

    let charge_in = 0;
    if (surplus > 0.15) {
      charge_in = Math.min(surplus, pCh);
    }

    let charge_eff = charge_in * effCh;

    const room = capacity_kwh - SOC;
    if (charge_eff > room) {
      charge_eff = room;
      charge_in = charge_eff / effCh;
    }

    SOC += charge_eff;
    surplus -= charge_in;

    const need = load - direct;
    let discharge_out = 0;

    if (need > 0) discharge_out = Math.min(need, pDis);

    let discharge_eff = discharge_out / effDis;

    const maxDis = SOC - SOC_min;
    if (discharge_eff > maxDis) {
      discharge_eff = maxDis;
      discharge_out = discharge_eff * effDis;
    }

    SOC -= discharge_eff;

    const auto_h = direct + discharge_out;
    const import_h = Math.max(0, load - auto_h);

    auto_total += auto_h;
    grid_total += import_h;
    surplus_total += Math.max(0, surplus);
    charge_in_total += charge_in;
    discharge_total += discharge_out;

    auto_hourly.push(auto_h);
    surplus_hourly.push(Math.max(0, surplus));
    batt_discharge_hourly.push(discharge_out);
    batt_charge_hourly.push(charge_eff);
    battery_soc_hourly.push(SOC);
  }

  const pv_total = pv_hourly.reduce((a, b) => a + (b || 0), 0);
  const battery_losses_kwh = Math.max(0, charge_in_total - discharge_total);

  const annual_charge_kwh = Math.round(
    batt_charge_hourly.reduce((a, b) => a + (Number(b) || 0), 0)
  );
  const annual_discharge_kwh = Math.round(
    batt_discharge_hourly.reduce((a, b) => a + (Number(b) || 0), 0)
  );
  const annual_throughput_kwh = annual_charge_kwh + annual_discharge_kwh;
  const equivalent_cycles =
    capacity_kwh > 0 ? annual_discharge_kwh / capacity_kwh : 0;
  const daily_cycles_avg = equivalent_cycles / 365;
  const battery_utilization_rate =
    capacity_kwh > 0 ? annual_discharge_kwh / (capacity_kwh * 365) : 0;

  return {
    ok: true,
    pv_hourly,
    conso_hourly,
    auto_hourly,
    surplus_hourly,
    batt_discharge_hourly,
    batt_charge_hourly,
    battery_soc_hourly,
    prod_kwh: Math.round(pv_total),
    auto_kwh: Math.round(auto_total),
    surplus_kwh: Math.round(surplus_total),
    grid_import_kwh: Math.round(grid_total),
    auto_pct: pv_total > 0 ? Math.round((auto_total / pv_total) * 100) : 0,
    battery_losses_kwh: Math.round(battery_losses_kwh),
    annual_charge_kwh,
    annual_discharge_kwh,
    annual_throughput_kwh,
    equivalent_cycles,
    daily_cycles_avg,
    battery_utilization_rate,
  };
}
