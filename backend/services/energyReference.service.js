import { createHash } from "node:crypto";

export const ENERGY_REFERENCE_VERSION = "ac-energy-ledger-1";
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const ratio = (a, b) => b > 0 ? a / b : null;

export function assertEnergyProfile(values, name, length = 8760) {
  if (!Array.isArray(values) || values.length !== length) throw new Error(`${name}: ${length} intervalles horaires requis`);
  values.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${name}[${i}]: energie kWh manquante ou invalide`);
  });
}

// Tolerance of floating point accumulation, never a display-rounding allowance.
export function energyTolerance(...values) {
  return 128 * Number.EPSILON * 8760 * Math.max(1, ...values.map(Math.abs));
}

export function validateEnergyBalance(e) {
  const equations = {
    production: [e.production_kwh, e.direct_kwh + e.battery_charge_solar_kwh + e.physical_export_kwh + e.curtailment_kwh],
    storage: [e.battery_charge_solar_kwh + e.battery_charge_grid_kwh, e.battery_discharge_solar_kwh + e.battery_discharge_grid_kwh + e.storage_losses_kwh + e.stock_change_kwh],
    consumption: [e.consumption_kwh, e.direct_kwh + e.battery_discharge_solar_kwh + e.battery_discharge_grid_kwh + e.grid_to_load_kwh],
  };
  const issues = [];
  for (const [key, value] of Object.entries(e)) {
    if (!key.endsWith("_kwh")) continue;
    if (!Number.isFinite(value) || (key !== "stock_change_kwh" && value < -energyTolerance(value))) issues.push(`${key}: flux invalide`);
  }
  for (const [name, [left, right]] of Object.entries(equations)) {
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > energyTolerance(left, right)) issues.push(`${name}: bilan non ferme (${left} / ${right} kWh)`);
  }
  return issues;
}

/** Physical boundary: AC PV available at site, AC loads, internal stored energy.
 * No grid charging or local delivery of virtual credits is supported here.
 * Curtailment is an explicit flow, not renamed as injection.
 */
export function buildEnergyReference({ pv, load, battery = null, scenarioId = "BASE", provenance = null, injectionLimitKw = null }) {
  assertEnergyProfile(pv, "production");
  assertEnergyProfile(load, "consommation");
  if (injectionLimitKw != null && (!Number.isFinite(injectionLimitKw) || injectionLimitKw < 0)) throw new Error("Puissance d'injection invalide");
  if (battery) {
    for (const key of ["direct_self_consumption_hourly", "batt_charge_input_hourly", "batt_discharge_hourly", "surplus_hourly", "battery_soc_hourly", "battery_losses_hourly"]) assertEnergyProfile(battery[key], key);
    if (!Number.isFinite(battery.soc_start_kwh)) throw new Error("Etat de charge initial manquant");
  }
  const keys = ["production_kwh", "consumption_kwh", "direct_kwh", "battery_charge_solar_kwh", "battery_charge_grid_kwh", "battery_discharge_solar_kwh", "battery_discharge_grid_kwh", "storage_losses_kwh", "stock_change_kwh", "physical_export_kwh", "curtailment_kwh", "grid_to_load_kwh"];
  const hourly = Object.fromEntries(keys.map((k) => [k, []]));
  let previousSoc = battery?.soc_start_kwh ?? 0;
  for (let h = 0; h < pv.length; h++) {
    const direct = battery ? battery.direct_self_consumption_hourly[h] : Math.min(pv[h], load[h]);
    const surplus = battery ? battery.surplus_hourly[h] : pv[h] - direct;
    const exported = injectionLimitKw == null ? surplus : Math.min(surplus, injectionLimitKw);
    const discharge = battery?.batt_discharge_hourly[h] ?? 0;
    const soc = battery?.battery_soc_hourly[h] ?? 0;
    if (battery?.resolved_parameters) {
      const b = battery.resolved_parameters;
      const eps = energyTolerance(soc, b.capacity_kwh);
      if (soc < b.min_soc_kwh - eps || soc > b.max_soc_kwh + eps ||
          (b.max_charge_kw != null && battery.batt_charge_input_hourly[h] > b.max_charge_kw + eps) ||
          (b.max_discharge_kw != null && discharge > b.max_discharge_kw + eps)) throw new Error(`Contraintes batterie : heure ${h}`);
    }
    const values = [pv[h], load[h], direct, battery?.batt_charge_input_hourly[h] ?? 0, 0, discharge, 0, battery?.battery_losses_hourly[h] ?? 0, soc - previousSoc, exported, surplus - exported, load[h] - direct - discharge];
    const row = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    const issues = validateEnergyBalance(row);
    if (issues.length) throw new Error(`Bilan horaire ${h}: ${issues.join("; ")}`);
    keys.forEach((k) => hourly[k].push(row[k]));
    previousSoc = soc;
  }
  const annual = Object.fromEntries(keys.map((k) => [k, sum(hourly[k])]));
  let start = 0;
  const monthly = DAYS.map((days) => {
    const end = start + days * 24;
    const row = Object.fromEntries(keys.map((k) => [k, sum(hourly[k].slice(start, end))]));
    start = end;
    return row;
  });
  for (const period of [...monthly, annual]) {
    const issues = validateEnergyBalance(period);
    if (issues.length) throw new Error(issues.join("; "));
  }
  const useful = annual.direct_kwh + annual.battery_discharge_solar_kwh;
  return {
    version: ENERGY_REFERENCE_VERSION,
    scenario_id: scenarioId,
    simulated_at: new Date().toISOString(),
    input_hash: createHash("sha256").update(JSON.stringify({ pv, load, battery: battery?.resolved_parameters ?? null, injectionLimitKw, scenarioId })).digest("hex"),
    boundary: "AC_PV_SITE_LOAD_INTERNAL_BATTERY_STOCK",
    timestep_hours: 1,
    calendar: "365_day_model_year",
    provenance,
    battery: battery?.resolved_parameters ?? null,
    annual,
    monthly,
    daily_average: Object.fromEntries(Object.entries(hourly).map(([k,series])=>[k,Array.from({length:24},(_,h)=>series.reduce((s,v,i)=>i%24===h?s+v:s,0)/365)])),
    ratios: {
      solar_coverage: ratio(useful, annual.consumption_kwh),
      direct_self_consumption: ratio(annual.direct_kwh, annual.production_kwh),
      useful_pv_utilization: ratio(useful, annual.production_kwh),
      captured_pv_before_storage_losses: ratio(annual.direct_kwh + annual.battery_charge_solar_kwh, annual.production_kwh),
    },
    validation: { status: "verified", hourly_periods: pv.length, monthly_periods: monthly.length },
  };
}
