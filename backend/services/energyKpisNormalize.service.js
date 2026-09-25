/**
 * KPIs énergie normalisés (audit P0) — une seule définition pour moteur / scenarios_v2 / PDF.
 */

import {
  computeExportPct,
  computePvSelfConsumptionPct,
  computeSiteAutonomyPct,
  computeSolarCoveragePct,
} from "./energyKpiDefinitions.service.js";

function round2(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Number(x);
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampKwh(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  let out = Math.max(min, n);
  if (Number.isFinite(max)) out = Math.min(out, max);
  return out;
}

function minPositiveCap(...vals) {
  const finite = vals.filter((v) => Number.isFinite(Number(v)) && Number(v) >= 0).map(Number);
  return finite.length > 0 ? Math.min(...finite) : Infinity;
}

/**
 * Attache sur scenario.energy les champs canoniques (mutatif).
 * Prérequis : energy.import = import réseau facturable (BV) ou physique ; energy.auto = énergie servie au site (direct + batterie).
 * @param {object} scenario
 */
export function attachNormalizedEnergyKpiFields(scenario) {
  if (!scenario || scenario._skipped === true) return;

  const e = scenario.energy && typeof scenario.energy === "object" ? { ...scenario.energy } : {};
  const ref = e.reference;
  if (ref?.scenario_id === (scenario.name ?? scenario.scenario_type ?? scenario.id) && ref.validation?.status === "verified") {
    const a = ref.annual;
    scenario.prod_kwh=a.production_kwh;
    scenario.conso_kwh=a.consumption_kwh;
    scenario.auto_kwh=a.direct_kwh+a.battery_discharge_solar_kwh;
    scenario.surplus_kwh=a.physical_export_kwh;
    scenario.import_kwh=a.grid_to_load_kwh;
    const useful = a.direct_kwh + a.battery_discharge_solar_kwh;
    Object.assign(e, {
      prod: a.production_kwh, production_kwh: a.production_kwh,
      conso: a.consumption_kwh, consumption_kwh: a.consumption_kwh,
      auto: useful, autoconsumption_kwh: useful, total_pv_used_on_site_kwh: useful,
      direct_self_consumption_kwh: a.direct_kwh,
      physical_battery_discharge_kwh: a.battery_discharge_solar_kwh,
      battery_discharge_kwh: a.battery_discharge_solar_kwh,
      physical_battery_charge_from_surplus_kwh: a.battery_charge_solar_kwh,
      battery_losses_kwh: a.storage_losses_kwh, battery_stock_change_kwh: a.stock_change_kwh,
      surplus: a.physical_export_kwh, exported_kwh: a.physical_export_kwh,
      import: a.grid_to_load_kwh, grid_import_kwh: a.grid_to_load_kwh,
      physical_grid_import_kwh: a.grid_to_load_kwh, physical_grid_export_kwh: a.physical_export_kwh,
      curtailment_kwh: a.curtailment_kwh,
      captured_pv_before_storage_losses_pct: ref.ratios.captured_pv_before_storage_losses == null ? null : ref.ratios.captured_pv_before_storage_losses * 100,
    });
  }
  const name = scenario.name ?? scenario.scenario_type;

  const prod =
    num(e.production_kwh) ??
    num(e.prod) ??
    num(scenario.prod_kwh) ??
    0;
  const conso =
    num(e.consumption_kwh) ??
    num(e.conso) ??
    num(scenario.conso_kwh) ??
    0;
  const gridImport =
    num(e.grid_import_kwh) ??
    num(e.import_kwh) ??
    num(e.import) ??
    num(scenario.import_kwh) ??
    0;
  const surplus =
    num(e.exported_kwh) ??
    num(e.surplus_kwh) ??
    num(e.surplus) ??
    num(scenario.surplus_kwh) ??
    0;
  const autoTotal = num(e.auto) ?? num(scenario.auto_kwh) ?? num(e.autoconsumption_kwh) ?? 0;
  const isVirtualLike = name === "BATTERY_VIRTUAL" || name === "BATTERY_HYBRID";

  let direct = num(e.direct_self_consumption_kwh);
  let battOut = num(e.battery_discharge_kwh);

  if (direct == null || !Number.isFinite(direct)) {
    if (name === "BATTERY_PHYSICAL") {
      battOut = num(scenario.battery?.annual_discharge_kwh) ?? 0;
      direct = Math.max(0, autoTotal - battOut);
    } else if (name === "BATTERY_VIRTUAL") {
      battOut =
        num(e.used_credit_kwh) ??
        num(e.restored_kwh) ??
        num(scenario.used_credit_kwh) ??
        num(scenario.battery_virtual?.annual_discharge_kwh) ??
        0;
      direct = Math.max(0, autoTotal - battOut);
    } else if (name === "BATTERY_HYBRID") {
      const physicalOut =
        num(e.physical_battery_discharge_kwh) ??
        num(scenario.battery?.annual_discharge_kwh) ??
        0;
      const virtualOut =
        num(e.virtual_battery_discharge_kwh) ??
        num(e.used_credit_kwh) ??
        num(e.restored_kwh) ??
        num(scenario.used_credit_kwh) ??
        num(scenario.battery_virtual?.annual_discharge_kwh) ??
        0;
      battOut = physicalOut + virtualOut;
      direct = Math.max(0, autoTotal - battOut);
    } else {
      direct = Math.max(0, autoTotal);
      battOut = 0;
    }
  }
  if (battOut == null || !Number.isFinite(battOut)) battOut = 0;

  const totalPvUsedRaw =
    num(e.total_pv_used_on_site_kwh) != null && Number.isFinite(num(e.total_pv_used_on_site_kwh))
      ? num(e.total_pv_used_on_site_kwh)
      : Math.max(0, direct + battOut);
  const pvUsedCap = minPositiveCap(prod, conso);
  const totalPvUsed = clampKwh(totalPvUsedRaw, 0, pvUsedCap) ?? 0;

  const creditStart =
    num(e.virtual_credit_start_kwh) ??
    num(scenario.virtual_credit_start_kwh) ??
    num(scenario.virtual_battery_rollover?.virtual_credit_start_kwh) ??
    num(scenario._virtualBattery8760?.virtual_battery_credit_start_kwh) ??
    0;
  const creditEnd =
    num(e.virtual_credit_end_kwh) ??
    num(scenario.virtual_credit_end_kwh) ??
    num(scenario.virtual_battery_rollover?.virtual_credit_end_kwh) ??
    num(scenario._virtualBattery8760?.virtual_battery_credit_end_kwh) ??
    0;
  const priorCreditUsedNet = Math.max(0, creditStart - creditEnd);
  const siteSolarOrCreditRaw = Math.max(0, conso - gridImport);
  const siteSolarOrCreditLimit = minPositiveCap(conso, isVirtualLike ? prod + priorCreditUsedNet : prod);
  const siteSolarOrCreditUsed = clampKwh(siteSolarOrCreditRaw, 0, siteSolarOrCreditLimit) ?? 0;

  const exported = num(e.exported_kwh) != null && Number.isFinite(num(e.exported_kwh)) ? num(e.exported_kwh) : surplus;

  e.direct_self_consumption_kwh = round2(direct) ?? 0;
  e.battery_discharge_kwh = round2(battOut) ?? 0;
  e.total_pv_used_on_site_kwh = round2(totalPvUsed) ?? 0;
  e.energy_solar_used_kwh = round2(totalPvUsed) ?? 0;
  e.site_solar_or_credit_used_kwh = ref?.virtual_credit ? totalPvUsed + ref.virtual_credit.used_kwh : (round2(siteSolarOrCreditUsed) ?? 0);
  e.grid_import_kwh = round2(gridImport) ?? 0;
  e.exported_kwh = round2(exported) ?? 0;
  if (prod > 0) {
    e.production_kwh = round2(prod);
  } else if (e.production_kwh == null && scenario.prod_kwh != null) {
    e.production_kwh = round2(scenario.prod_kwh);
  }
  if (conso > 0) {
    e.consumption_kwh = round2(conso);
  } else if (e.consumption_kwh == null && scenario.conso_kwh != null) {
    e.consumption_kwh = round2(scenario.conso_kwh);
  }
  if (totalPvUsed >= 0) {
    e.autoconsumption_kwh = round2(totalPvUsed);
  }

  const kpiIn = {
    production_kwh: prod,
    total_pv_used_on_site_kwh: totalPvUsed,
    consumption_kwh: conso,
    grid_import_kwh: gridImport,
    surplus_kwh: exported,
  };
  e.pv_self_consumption_pct = computePvSelfConsumptionPct(kpiIn);
  e.site_autonomy_pct = computeSiteAutonomyPct(kpiIn);
  e.solar_coverage_pct = computeSolarCoveragePct(kpiIn);
  e.export_pct = computeExportPct(kpiIn);

  /** @deprecated Alias legacy — = pv_self_consumption_pct (ne pas confondre avec couverture conso). */
  scenario.self_consumption_pct = e.pv_self_consumption_pct;
  /** Couverture besoins par le solaire (kWh utiles / conso) — aligné sur solar_coverage_pct. */
  scenario.self_production_pct = e.solar_coverage_pct;

  scenario.energy = e;
}
