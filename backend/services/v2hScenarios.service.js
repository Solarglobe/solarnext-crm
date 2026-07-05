// ======================================================================
// Phase 3B — Génération ÉNERGIE des scénarios Voiture V2H (4 combos).
// Chaînage résiduel : solaire → maison → batterie physique → voiture V2H → batterie virtuelle.
// Réutilise simulateBattery8760 (physique + V2H) et simulateVirtualBattery8760 (virtuel).
//
// Cette couche calcule UNIQUEMENT l'énergie (pas de finance/CAPEX ni de forme de
// scénario complète) → testable en isolation. calc.controller (3B-2) l'appelle,
// résout la capacité virtuelle et enveloppe le résultat dans la structure scénario.
//
// Invariants : bilan maison bouclé (auto + import = conso) ; ev_grid_charge_kwh
// (mobilité) est SÉPARÉ de l'import maison, jamais confondu.
// ======================================================================

import { simulateBattery8760 } from "./batteryService.js";
import { simulateVirtualBattery8760 } from "./virtualBattery8760.service.js";
import { buildV2hAvailabilityHourly } from "./v2hAvailability.js";

function sum(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] || 0; return s; }
function residualImport(conso, autoHourly) {
  return conso.map((c, h) => Math.max(0, (c || 0) - (autoHourly[h] || 0)));
}

/** Config batterie (hardware) du véhicule pour simulateBattery8760. */
function vehicleBatteryConfig(v) {
  return {
    enabled: true,
    capacity_kwh: Number(v.capacity_kwh),
    roundtrip_efficiency: v.roundtrip_efficiency != null ? Number(v.roundtrip_efficiency) : 0.85,
    max_charge_kw: v.max_charge_kw != null ? Number(v.max_charge_kw) : 11,
    max_discharge_kw: v.max_discharge_kw != null ? Number(v.max_discharge_kw) : 5,
  };
}
/** Paramètres V2H (réserve, disponibilité, trajets) pour simulateBattery8760. */
function vehicleV2hParams(v, simulationYear) {
  return {
    min_soc_pct: v.min_reserve_pct != null ? Number(v.min_reserve_pct) : 50,
    availability_hourly: buildV2hAvailabilityHourly(
      {
        weekday_plug_in_hour: v.weekday_plug_in_hour,
        weekday_departure_hour: v.weekday_departure_hour,
        weekend_present: v.weekend_present,
        unavailable_weeks: v.unavailable_weeks,
      },
      simulationYear
    ),
    daily_drive_kwh: v.daily_drive_kwh != null ? Number(v.daily_drive_kwh) : 0,
    daily_drive_hour: v.weekday_departure_hour != null ? Number(v.weekday_departure_hour) : 7,
  };
}

function evFields(v2hRes) {
  return {
    ev_v2h_discharge_kwh: v2hRes.ev_v2h_discharge_kwh ?? 0,
    ev_solar_charge_kwh: v2hRes.ev_solar_charge_kwh ?? 0,
    ev_grid_charge_kwh: v2hRes.ev_grid_charge_kwh ?? 0,   // mobilité — SÉPARÉ de l'import maison
    ev_trip_consumption_kwh: v2hRes.ev_trip_consumption_kwh ?? 0,
    ev_battery_losses_kwh: v2hRes.ev_battery_losses_kwh ?? 0,
    ev_reserve_kwh: v2hRes.ev_reserve_kwh ?? 0,
    ev_plugged_hours_year: v2hRes.ev_plugged_hours_year ?? 0,
  };
}

/**
 * @returns {Object} clés parmi VEHICLE_V2H / _PHYSICAL / _VIRTUAL / _PHYSICAL_VIRTUAL
 *   (uniquement les combos dont TOUS les actifs sont activés). {} si véhicule non activé.
 *   Chaque valeur : { scenario_id, production_kwh, consumption_kwh, auto_kwh, grid_import_kwh,
 *   surplus_kwh, ev_*..., physical_discharge_kwh?, virtual_discharged_kwh?, energy_basis }
 *   ou { scenario_id, _skipped:true, reason } si le véhicule est activé mais incomplet.
 */
export function buildV2hEnergyScenarios({
  pv_hourly,
  conso_hourly,
  physicalBattery,
  virtualConfig,
  virtualCapacityKwh,
  vehicle,
  simulationYear,
}) {
  if (!vehicle || vehicle.enabled !== true) return {};

  const physEnabled = physicalBattery?.enabled === true && Number(physicalBattery?.capacity_kwh) > 0;
  const virtEnabled = virtualConfig?.enabled === true;
  const vehCapacityOk = Number.isFinite(Number(vehicle.capacity_kwh)) && Number(vehicle.capacity_kwh) > 0;

  const wanted = ["VEHICLE_V2H"];
  if (physEnabled) wanted.push("VEHICLE_V2H_PHYSICAL");
  if (virtEnabled) wanted.push("VEHICLE_V2H_VIRTUAL");
  if (physEnabled && virtEnabled) wanted.push("VEHICLE_V2H_PHYSICAL_VIRTUAL");

  // Véhicule activé mais incomplet → scénarios _skipped (garde-fou Phase 2 les bloque).
  if (!vehCapacityOk) {
    const out = {};
    for (const id of wanted) out[id] = { scenario_id: id, _skipped: true, reason: "vehicle_incomplete" };
    return out;
  }

  const prod = Math.round(sum(pv_hourly));
  const conso = Math.round(sum(conso_hourly));
  const battV2H = vehicleBatteryConfig(vehicle);
  const parV2H = vehicleV2hParams(vehicle, simulationYear);
  const runV2H = (pv, load) => simulateBattery8760({ pv_hourly: pv, conso_hourly: load, battery: battV2H, v2h: parV2H });
  const runPhys = (pv, load) => simulateBattery8760({ pv_hourly: pv, conso_hourly: load, battery: physicalBattery });
  const runVirt = (pv, load) =>
    simulateVirtualBattery8760({ pv_hourly: pv, conso_hourly: load, config: { ...(virtualConfig || {}), capacity_kwh: virtualCapacityKwh } });

  const base = (id) => ({ scenario_id: id, production_kwh: prod, consumption_kwh: conso, energy_basis: "hourly_8760" });
  const out = {};

  // 1) VEHICLE_V2H — voiture seule
  {
    const v = runV2H(pv_hourly, conso_hourly);
    out.VEHICLE_V2H = {
      ...base("VEHICLE_V2H"),
      auto_kwh: v.auto_kwh, grid_import_kwh: v.grid_import_kwh, surplus_kwh: v.surplus_kwh,
      ...evFields(v),
    };
  }

  // 2) VEHICLE_V2H_PHYSICAL — physique puis V2H sur résidu
  if (physEnabled) {
    const p = runPhys(pv_hourly, conso_hourly);
    const impAfterP = residualImport(conso_hourly, p.auto_hourly);
    const v = runV2H(p.surplus_hourly, impAfterP);
    out.VEHICLE_V2H_PHYSICAL = {
      ...base("VEHICLE_V2H_PHYSICAL"),
      auto_kwh: Math.round(p.auto_kwh + v.auto_kwh),
      grid_import_kwh: v.grid_import_kwh,
      surplus_kwh: v.surplus_kwh,
      physical_discharge_kwh: p.annual_discharge_kwh ?? 0,
      ...evFields(v),
    };
  }

  // 3) VEHICLE_V2H_VIRTUAL — V2H puis virtuel sur résidu
  if (virtEnabled) {
    const v = runV2H(pv_hourly, conso_hourly);
    const impAfterV = residualImport(conso_hourly, v.auto_hourly);
    const vb = runVirt(v.surplus_hourly, impAfterV);
    const vbDischarged = vb.ok ? (vb.virtual_battery_total_discharged_kwh ?? 0) : 0;
    out.VEHICLE_V2H_VIRTUAL = {
      ...base("VEHICLE_V2H_VIRTUAL"),
      auto_kwh: Math.round(v.auto_kwh + vbDischarged),
      grid_import_kwh: vb.ok ? vb.grid_import_kwh : v.grid_import_kwh,
      surplus_kwh: vb.ok ? (vb.virtual_battery_overflow_export_kwh ?? 0) : v.surplus_kwh,
      virtual_discharged_kwh: vbDischarged,
      _virtual_sim_ok: vb.ok === true,
      ...evFields(v),
    };
  }

  // 4) VEHICLE_V2H_PHYSICAL_VIRTUAL — physique → V2H → virtuel
  if (physEnabled && virtEnabled) {
    const p = runPhys(pv_hourly, conso_hourly);
    const impAfterP = residualImport(conso_hourly, p.auto_hourly);
    const v = runV2H(p.surplus_hourly, impAfterP);
    const impAfterV = residualImport(impAfterP, v.auto_hourly);
    const vb = runVirt(v.surplus_hourly, impAfterV);
    const vbDischarged = vb.ok ? (vb.virtual_battery_total_discharged_kwh ?? 0) : 0;
    out.VEHICLE_V2H_PHYSICAL_VIRTUAL = {
      ...base("VEHICLE_V2H_PHYSICAL_VIRTUAL"),
      auto_kwh: Math.round(p.auto_kwh + v.auto_kwh + vbDischarged),
      grid_import_kwh: vb.ok ? vb.grid_import_kwh : v.grid_import_kwh,
      surplus_kwh: vb.ok ? (vb.virtual_battery_overflow_export_kwh ?? 0) : v.surplus_kwh,
      physical_discharge_kwh: p.annual_discharge_kwh ?? 0,
      virtual_discharged_kwh: vbDischarged,
      _virtual_sim_ok: vb.ok === true,
      ...evFields(v),
    };
  }

  return out;
}
