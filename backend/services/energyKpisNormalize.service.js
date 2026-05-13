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
  return Math.round(Number(x) * 100) / 100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Attache sur scenario.energy les champs canoniques (mutatif).
 * Prérequis : energy.import = import réseau facturable (BV) ou physique ; energy.auto = énergie servie au site (direct + batterie).
 * @param {object} scenario
 */
export function attachNormalizedEnergyKpiFields(scenario) {
  if (!scenario || scenario._skipped === true) return;

  const e = scenario.energy && typeof scenario.energy === "object" ? { ...scenario.energy } : {};
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
    } else {
      direct = Math.max(0, autoTotal);
      battOut = 0;
    }
  }
  if (battOut == null || !Number.isFinite(battOut)) battOut = 0;

  const totalPvUsed =
    num(e.total_pv_used_on_site_kwh) != null && Number.isFinite(num(e.total_pv_used_on_site_kwh))
      ? num(e.total_pv_used_on_site_kwh)
      : Math.max(0, direct + battOut);

  const exported = num(e.exported_kwh) != null && Number.isFinite(num(e.exported_kwh)) ? num(e.exported_kwh) : surplus;

  e.direct_self_consumption_kwh = round2(direct) ?? 0;
  e.battery_discharge_kwh = round2(battOut) ?? 0;
  e.total_pv_used_on_site_kwh = round2(totalPvUsed) ?? 0;
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
