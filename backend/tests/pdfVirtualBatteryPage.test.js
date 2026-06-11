/**
 * PDF V2 - Page batterie virtuelle conditionnelle.
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
    client: { full_name: "Nom complet fiche lead", nom: "Client", prenom: "Test", ville: "Nantes", cp: "44000", adresse: "1 rue test" },
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
  assert(vmBase.client?.name === "Nom complet fiche lead", "PDF client name must prefer lead detail full_name over stale meta.client_nom");
  assert(vmBase.fullReport?.p7_virtual_battery == null, "BASE: virtual battery page must be absent");

  const vmVirtual = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BATTERY_VIRTUAL",
    scenarios_v2: scenariosV2,
  });
  const page = vmVirtual.fullReport?.p7_virtual_battery;
  assert(page != null, "BATTERY_VIRTUAL: virtual battery page must be present");
  assert(page.with_virtual_battery?.pv_total_used_kwh === 9234, "total PV used must be consumption - canonical import");
  assert(page.contribution?.recovered_kwh === 4200, "recovered energy must come from battery_discharge_kwh");

  const vmLegacyInconsistent = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BATTERY_VIRTUAL",
    scenarios_v2: [
      scenariosV2[0],
      {
        id: "BATTERY_VIRTUAL",
        energy: {
          production_kwh: 9152,
          consumption_kwh: 10200,
          total_pv_used_on_site_kwh: 4733,
          autoconsumption_kwh: 4733,
          energy_solar_used_kwh: 4733,
          import_kwh: 2010,
          energy_grid_import_kwh: 1048,
          billable_import_kwh: 1048,
          site_autonomy_pct: 80.3,
          solar_coverage_pct: 80.3,
          pv_self_consumption_pct: 52,
        },
        finance: { estimated_annual_bill_eur: 392, residual_bill_eur: 392, annual_cashflows: [] },
        production: { annual_kwh: 9152, monthly_kwh: Array(12).fill(763) },
      },
    ],
  });
  const p6Totals = vmLegacyInconsistent.fullReport?.p6?.p6?.totals;
  const p6Series = vmLegacyInconsistent.fullReport?.p6?.p6;
  const p7 = vmLegacyInconsistent.fullReport?.p7;
  assert(Math.round(p6Totals?.solar_used_kwh) === 9152, "P6: covered kWh = consumption - canonical import");
  assert(Math.round(p6Totals?.grid_import_kwh) === 1048, "P6: import = canonical import");
  assert(Math.round(p6Series?.grid?.reduce((a, b) => a + b, 0)) === 1048, "P6 chart grid series must match canonical import");
  assert(
    Math.round(
      p6Series?.dir?.reduce((a, b) => a + b, 0) +
        p6Series?.bat?.reduce((a, b) => a + b, 0) +
        p6Series?.grid?.reduce((a, b) => a + b, 0)
    ) === 10200,
    "P6 chart stacked series must match annual consumption"
  );
  assert(Math.round(p7?.energy_solar_used_kwh) === 9152, "P7: covered kWh = consumption - canonical import");
  assert(Math.round(p7?.energy_grid_import_kwh) === 1048, "P7: import = canonical import");
  assert(Math.round(p7?.solar_coverage_pct) === 90, "P7: pct must match covered kWh");

  console.log("OK - pdfVirtualBatteryPage.test");
}

main();
