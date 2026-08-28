/**
 * ACHOURI virtual battery PDF mapper guard.
 * Usage: node --test backend/tests/pdfAchouriVirtualMapper.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

function buildSnapshot({ production, direct, credit, gridImport, capex }) {
  return {
    computed_at: "2026-08-28T10:00:00.000Z",
    scenario_type: "BATTERY_VIRTUAL",
    client: { full_name: "Sami ACHOURI" },
    site: { puissance_compteur_kva: 9, type_reseau: "mono", lat: 48.958094 },
    hardware: { kwc: production > 5000 ? 6 : 3 },
    installation: { panneaux_nombre: production > 5000 ? 12 : 6 },
    energy: {
      production_kwh: production,
      consumption_kwh: 11000,
      direct_self_consumption_kwh: direct,
      surplus_used_by_virtual_battery_kwh: credit,
      virtual_battery_discharge_kwh: credit,
      billable_import_kwh: gridImport,
      overflow_export_kwh: 0,
      monthly: [],
      billable_monthly: [],
    },
    finance: {
      capex_ttc: capex,
      economie_year_1: 500,
      roi_years: 12,
      irr_pct: 9,
      virtual_battery_finance: {
        annual_total_virtual_cost_ttc: 299,
        annual_activation_fee_ttc: 299,
      },
    },
  };
}

test("ACHOURI 3 kWc PDF VM keeps direct, credit and reconciled production distinct", () => {
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(buildSnapshot({
    production: 3410,
    direct: 962,
    credit: 2448.771,
    gridImport: 7589,
    capex: 6800,
  }), { studyNumber: "SGS-2026-0166" });

  assert.equal(vm.production.annualProductionKwh, 3411);
  assert.equal(vm.fullReport.p2.p2_auto.p2_production, "3 411 kWh");
  assert.equal(vm.fullReport.p3.energy_summary.production_kwh, 3411);
  assert.equal(vm.fullReport.p3.energy_summary.direct_self_consumption_kwh, 962);
  assert.equal(vm.fullReport.p3.energy_summary.surplus_creditable_kwh, 2449);
  assert.equal(vm.fullReport.p4.production_annuelle, 3411);
  assert.equal(vm.fullReport.p4.energie_consommee_directement, 962);
  assert.equal(vm.fullReport.p4.energie_solaire_valorisee, 3411);
  assert.equal(vm.fullReport.p4.surplus_brut_kwh, 2449);
  assert.equal(vm.fullReport.p7.energy_solar_used_direct_kwh, 962);
  assert.equal(vm.fullReport.p7.credited_kwh, 2449);
  assert.equal(vm.fullReport.p7.energy_grid_import_kwh, 7589);
  assert.equal(vm.fullReport.p10.best.annual_production_kwh, 3411);
});

test("ACHOURI 6 kWc PDF VM keeps direct, credit and reconciled production distinct", () => {
  const vm = mapSelectedScenarioSnapshotToPdfViewModel(buildSnapshot({
    production: 6778,
    direct: 1124,
    credit: 5654.602,
    gridImport: 4221,
    capex: 10700,
  }), { studyNumber: "SGS-2026-0165" });

  assert.equal(vm.production.annualProductionKwh, 6779);
  assert.equal(vm.fullReport.p2.p2_auto.p2_production, "6 779 kWh");
  assert.equal(vm.fullReport.p3.energy_summary.production_kwh, 6779);
  assert.equal(vm.fullReport.p3.energy_summary.direct_self_consumption_kwh, 1124);
  assert.equal(vm.fullReport.p3.energy_summary.surplus_creditable_kwh, 5655);
  assert.equal(vm.fullReport.p4.production_annuelle, 6779);
  assert.equal(vm.fullReport.p4.energie_consommee_directement, 1124);
  assert.equal(vm.fullReport.p4.energie_solaire_valorisee, 6779);
  assert.equal(vm.fullReport.p4.surplus_brut_kwh, 5655);
  assert.equal(vm.fullReport.p7.energy_solar_used_direct_kwh, 1124);
  assert.equal(vm.fullReport.p7.credited_kwh, 5655);
  assert.equal(vm.fullReport.p7.energy_grid_import_kwh, 4221);
  assert.equal(vm.fullReport.p10.best.annual_production_kwh, 6779);
});
