/**
 * PDF V2 — Page batterie virtuelle conditionnelle.
 * Usage: node backend/tests/pdfVirtualBatteryPage.test.js
 */

import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function buildSnapshot() {
  return {
    scenario_type: "BASE",
    created_at: new Date().toISOString(),
    meta: { client_nom: "Test PDF" },
    client: { nom: "Client", prenom: "Test", ville: "Nantes", cp: "44000", adresse: "1 rue test" },
    site: { type_reseau: "mono", puissance_compteur_kva: 9, lat: 47.2, lon: -1.55 },
    installation: { puissance_kwc: 6, panneaux_nombre: 12, production_annuelle_kwh: 13457 },
    equipment: {},
    shading: {},
    energy: { consumption_kwh: 15500, production_kwh: 13457, import_kwh: 6266 },
    finance: { capex_ttc: 18000, economie_year_1: 1200, economie_total: 30000, roi_years: 10, irr_pct: 7.2 },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
    cashflows: [],
    assumptions: {},
    form: {},
    conso: { annual_kwh: 15500 },
  };
}

const scenariosV2 = [
  {
    id: "BASE",
    name: "BASE",
    energy: {
      production_kwh: 13457,
      consumption_kwh: 15500,
      direct_self_consumption_kwh: 5000,
      total_pv_used_on_site_kwh: 5000,
      import_kwh: 10500,
      exported_kwh: 8457,
    },
    finance: { capex_ttc: 18000, economie_year_1: 1000, economie_total: 25000, roi_years: 11, annual_cashflows: [] },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
  },
  {
    id: "BATTERY_VIRTUAL",
    name: "BATTERY_VIRTUAL",
    energy: {
      production_kwh: 13457,
      consumption_kwh: 15500,
      direct_self_consumption_kwh: 5000,
      battery_discharge_kwh: 4200,
      total_pv_used_on_site_kwh: 9200,
      import_kwh: 6266,
      exported_kwh: 4257,
      site_autonomy_pct: (9200 / 15500) * 100,
      pv_self_consumption_pct: (9200 / 13457) * 100,
    },
    finance: { capex_ttc: 18000, economie_year_1: 1200, economie_total: 30000, roi_years: 10, annual_cashflows: [] },
    production: { annual_kwh: 13457, monthly_kwh: Array(12).fill(1121) },
  },
];

function main() {
  const snapshot = buildSnapshot();

  const vmBase = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BASE",
    scenarios_v2: scenariosV2,
  });
  assert(vmBase.fullReport?.p7_virtual_battery == null, "BASE: la page batterie virtuelle doit etre absente");

  const vmVirtual = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BATTERY_VIRTUAL",
    scenarios_v2: scenariosV2,
  });
  const page = vmVirtual.fullReport?.p7_virtual_battery;
  assert(page != null, "BATTERY_VIRTUAL: la page batterie virtuelle doit etre presente");
  assert(page.with_virtual_battery?.pv_total_used_kwh === 9200, "total PV utilisee doit venir des donnees moteur");
  assert(page.contribution?.recovered_kwh === 4200, "energie recuperee doit venir de battery_discharge_kwh");

  console.log("OK — pdfVirtualBatteryPage.test");
}

main();
