/**
 * Validation BATTERY_VIRTUAL : finance, scenarios_v2 (mapper), PDF P8.
 * Usage: cd backend && node scripts/test-battery-virtual.js
 */

import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { computeFinance } from "../services/financeService.js";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

const HOURS = 8760;

function makeHourly(size, valueFn) {
  return Array.from({ length: size }, (_, i) => (typeof valueFn === "function" ? valueFn(i) : valueFn));
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const baseCtx = {
  pv: {
    hourly: makeHourly(HOURS, (i) => (i >= 2000 && i < 4000 ? 2.5 : 0.4)),
    kwc: 6,
    panelsCount: 12,
  },
  conso: { hourly: makeHourly(HOURS, 0.5), clamped: null },
  conso_p_pilotee: makeHourly(HOURS, 0.5),
  form: { maison: { panneaux_max: 12 } },
  settings: { economics: { horizon_years: 25 } },
};

const base = buildScenarioBaseV2({ ...baseCtx, finance_input: { capex_ttc: 18000 } });
const virtualScenario = JSON.parse(JSON.stringify(base));
virtualScenario.name = "BATTERY_VIRTUAL";
virtualScenario.battery = "virtual";
virtualScenario._v2 = true;
virtualScenario._virtualBatteryQuote = { annual_cost_ht: 300, annual_cost_ttc: 360, detail: {} };

const credited = 1500;
const restored = 1100;
const billable = Math.max(0, (virtualScenario.energy?.import ?? virtualScenario.import_kwh ?? 0) - 200);

virtualScenario.energy = {
  ...(virtualScenario.energy || {}),
  production_kwh: base.prod_kwh,
  consumption_kwh: base.conso_kwh,
  autoconsumption_kwh: base.auto_kwh,
  import_kwh: billable,
  surplus_kwh: base.surplus_kwh,
  credited_kwh: credited,
  used_credit_kwh: restored,
  restored_kwh: restored,
  billable_import_kwh: billable,
  overflow_export_kwh: 80,
  grid_import_kwh: billable,
  grid_export_kwh: base.surplus_kwh,
};
virtualScenario.import_kwh = billable;
virtualScenario.billable_import_kwh = billable;
virtualScenario.credited_kwh = credited;
virtualScenario.used_credit_kwh = restored;
virtualScenario.battery_virtual = {
  enabled: true,
  capacity_simulated_kwh: 12,
  annual_charge_kwh: credited,
  annual_discharge_kwh: restored,
  annual_throughput_kwh: credited + restored,
  credited_kwh: credited,
  restored_kwh: restored,
  overflow_export_kwh: 80,
  cycles_equivalent: restored / 12,
};
virtualScenario._virtualBattery8760 = {
  virtual_battery_hourly_charge_kwh: makeHourly(HOURS, 0.02),
  virtual_battery_hourly_discharge_kwh: makeHourly(HOURS, 0.015),
  virtual_battery_hourly_credit_balance_kwh: makeHourly(HOURS, 5),
  hourly_charge: makeHourly(HOURS, 0.02),
  hourly_discharge: makeHourly(HOURS, 0.015),
  hourly_state: makeHourly(HOURS, 5),
};

const ctx = {
  ...baseCtx,
  form: { ...baseCtx.form, params: { tarif_kwh: 0.2 } },
  finance_input: { capex_ttc: 18000 },
  settings: { economics: { horizon_years: 25 } },
};

const fin = await computeFinance(ctx, { BASE: base, BATTERY_VIRTUAL: virtualScenario });
const vFin = fin.scenarios.BATTERY_VIRTUAL;

assert(vFin != null, "scénario BATTERY_VIRTUAL présent après finance");
assert(
  vFin.economie_an1 != null && Number.isFinite(vFin.economie_an1),
  "economie_an1 doit être calculée",
);

const ctxMap = { pv: baseCtx.pv, battery_input: { capacity_kwh: null }, production: { annualKwh: base.prod_kwh } };
const v2Virtual = mapScenarioToV2(vFin, ctxMap);
const v2Base = mapScenarioToV2(fin.scenarios.BASE, ctxMap);

assert(v2Virtual.scenario_type === "BATTERY_VIRTUAL", "scenario_type dans JSON");
assert(v2Virtual.id === "BATTERY_VIRTUAL", "id BATTERY_VIRTUAL");
assert((v2Virtual.energy?.credited_kwh ?? 0) > 0, "credited_kwh > 0 dans scenarios_v2");
assert((v2Virtual.energy?.restored_kwh ?? 0) > 0, "restored_kwh > 0 dans scenarios_v2");
assert(v2Virtual.battery_virtual != null && v2Virtual.battery_virtual.enabled === true, "battery_virtual dans JSON");
assert(
  Array.isArray(v2Virtual.virtual_battery_8760?.hourly_charge) &&
    v2Virtual.virtual_battery_8760.hourly_charge.length >= 24,
  "virtual_battery_8760.hourly_charge accessible",
);
assert(v2Virtual.finance?.economie_year_1 != null, "finance.economie_year_1 non null après mapper");

const scenariosV2 = [v2Base, v2Virtual];
const snapshot = {
  scenario_type: "BATTERY_VIRTUAL",
  created_at: new Date().toISOString(),
  client: { nom: "Test", prenom: "BV", adresse: "", cp: "75001", ville: "Paris" },
  site: { lat: 48.85, lon: 2.35, orientation_deg: 180, tilt_deg: 30, puissance_compteur_kva: 9, type_reseau: "mono" },
  installation: { panneaux_nombre: 12, puissance_kwc: 6, production_annuelle_kwh: base.prod_kwh, surface_panneaux_m2: null },
  equipment: {
    panneau: { marque: "X", modele: "Y", puissance_wc: 400 },
    onduleur: { marque: "Z", modele: "M", quantite: 1 },
    batterie: { capacite_kwh: null, type: null },
  },
  shading: { near_loss_pct: 0, far_loss_pct: 0, total_loss_pct: 0 },
  energy: {
    production_kwh: v2Virtual.energy?.production_kwh,
    consumption_kwh: v2Virtual.energy?.consumption_kwh,
    autoconsumption_kwh: v2Virtual.energy?.autoconsumption_kwh,
    surplus_kwh: v2Virtual.energy?.surplus_kwh,
    import_kwh: v2Virtual.energy?.import_kwh,
    independence_pct: 20,
  },
  finance: {
    capex_ttc: v2Virtual.finance?.capex_ttc ?? 18000,
    economie_year_1: v2Virtual.finance?.economie_year_1,
    economie_total: v2Virtual.finance?.economie_total,
    roi_years: v2Virtual.finance?.roi_years,
    irr_pct: v2Virtual.finance?.irr_pct,
    facture_restante: 2000,
    revenu_surplus: 100,
  },
  production: { annual_kwh: base.prod_kwh, monthly_kwh: Array(12).fill(Math.round(base.prod_kwh / 12)) },
};

const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
  scenarios_v2: scenariosV2,
  selected_scenario_id: "BATTERY_VIRTUAL",
  studyNumber: "TEST-BV",
});

assert(vm.fullReport?.p8 != null, "PDF fullReport.p8 présent pour comparatif batterie");
assert(
  Number(vm.fullReport.p8.B?.battery_throughput_kwh) > 0,
  "P8 battery_throughput_kwh > 0 (batterie virtuelle)",
);
assert(
  vm.fullReport.p8.hypotheses?.cycles_an != null && Number(vm.fullReport.p8.hypotheses.cycles_an) > 0,
  "P8 cycles équivalents présents",
);
assert(
  vm.fullReport.p8.detailsBatterie != null &&
    typeof vm.fullReport.p8.detailsBatterie.reduction_achat_eur === "number",
  "P8 reduction_achat_eur numérique",
);
assert(
  vm.fullReport.p8.profile?.charge?.some((x) => x > 0),
  "P8 profile.charge contient des valeurs (extrait 8760)",
);

console.log("✅ test-battery-virtual.js — OK (finance, scenarios_v2, PDF P8)");
