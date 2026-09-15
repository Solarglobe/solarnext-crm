import test from "node:test";
import assert from "node:assert/strict";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

const ledger = (extra = {}) => ({
  status: "FULL", current_contract: { contract_type: "HPHC" },
  scenario_contract: { contract_type: "BASE", provider_code: "URBAN_SOLAR" },
  current_energy_bill_eur: 850, current_supplier_subscription_eur: 150,
  scenario_energy_purchase_eur: 300, scenario_supplier_subscription_eur: 200,
  virtual_service_cost_eur: 150, bill_before_eur: 1000, bill_after_eur: 650,
  bill_savings_eur: 350, missing_fields: [], ...extra,
});

function scenario(billing) {
  return {
    id: "BATTERY_VIRTUAL", name: "BATTERY_VIRTUAL", capex_ttc: 10000,
    economie_an1: 999, economie_25a: 99999, roi_years: 3, irr_pct: 18,
    residual_bill_eur: 12, electricity_billing: billing,
    energy: { production_kwh: 5000, consumption_kwh: 6000, autoconsumption_kwh: 2000,
      direct_self_consumption_kwh: 2000, import_kwh: 2000, billable_import_kwh: 2000,
      virtual_battery_discharge_kwh: 2000, overflow_export_kwh: 1000, monthly: [] },
    virtual_battery_finance: { provider_code: "URBAN_SOLAR", annual_grid_import_cost_ttc: 300,
      annual_total_virtual_cost_ttc: 150, annual_overflow_export_revenue_ttc: 90,
      annual_subscription_ttc: 100, annual_virtual_discharge_cost_ttc: 50 },
  };
}

function pdf(mapped) {
  return mapSelectedScenarioSnapshotToPdfViewModel({
    scenario_type: "BATTERY_VIRTUAL", client: { full_name: "Client tarifs personnalisés" },
    energy: mapped.energy, finance: mapped.finance, virtual_battery_finance: mapped.virtual_battery_finance,
    hardware: { kwc: 5 }, site: { puissance_compteur_kva: 9 },
  });
}

test("V2 puis PDF conservent les factures complètes, sans double frais ni revente déduite", () => {
  const mapped = mapScenarioToV2(scenario(ledger()), {});
  assert.equal(mapped.finance.baseline_annual_bill_eur, 1000);
  assert.equal(mapped.finance.estimated_annual_bill_eur, 650);
  assert.equal(mapped.finance.bill_after_eur, 650);
  const vm = pdf(mapped);
  assert.equal(vm.savings.annualElectricityBillBefore, 1000);
  assert.equal(vm.savings.annualElectricityBillAfter, 650);
  assert.equal(vm.economics.annualSavings, 350);
  assert.equal(vm.fullReport.p7.estimated_annual_bill_eur, 650);
  assert.equal(vm.fullReport.p7_virtual_battery.kpis.estimated_annual_bill_eur, 650);
  assert.equal(vm.fullReport.p10.residual_bill_virtual.supplier_subscription_eur, 200);
  assert.equal(vm.fullReport.p10.residual_bill_virtual.energy_purchase_from_grid_eur, 300);
  assert.doesNotMatch(vm.fullReport.p10.residual_bill_virtual.supplier_subscription_note, /non ventilé/);
});

test("contrat incomplet : aucun ancien chiffre ni fallback ne recrée des économies ou un ROI", () => {
  const mapped = mapScenarioToV2(scenario(ledger({ status: "INCOMPLETE", bill_before_eur: null,
    bill_after_eur: null, bill_savings_eur: null, missing_fields: ["CURRENT_SUPPLIER_SUBSCRIPTION"] })), {});
  assert.equal(mapped.finance.economie_year_1, null);
  assert.equal(mapped.finance.roi_years, null);
  assert.equal(mapped.finance.estimated_annual_bill_eur, null);
  const vm = pdf(mapped);
  assert.equal(vm.economics.annualSavings, null);
  assert.equal(vm.economics.roiYears, null);
  assert.equal(vm.savings.annualElectricityBillAfter, null);
  assert.equal(vm.fullReport.p7.estimated_annual_bill_eur, null);
  assert.equal(vm.fullReport.p7_virtual_battery.kpis.estimated_annual_bill_eur, null);
  assert.equal(vm.fullReport.p1.p1_auto.p1_m_gain, "Contrat à compléter");
  assert.equal(vm.fullReport.p2.p2_auto.p2_roi, "Contrat à compléter");
  assert.deepEqual(vm.fullReport.p11.data.economies_annuelles_25, []);
});

test("une batterie virtuelle plus chère que le contrat actuel affiche une économie négative", () => {
  const vm = pdf(mapScenarioToV2(scenario(ledger({ bill_before_eur: 500, bill_after_eur: 650, bill_savings_eur: -150 })), {}));
  assert.equal(vm.economics.annualSavings, -150);
  assert.equal(vm.fullReport.p10.best.savings_year1_eur, -150);
});

test("la projection de factures PDF lit les factures des flux, sans y soustraire vente et prime", () => {
  const input = scenario(ledger());
  input.flows = Array.from({ length: 25 }, (_, i) => ({ year: i + 1,
    bill_without_project_eur: 1000, bill_with_project_and_service_eur: 650,
    total_eur: 440, cumul_gains_eur: 440 * (i + 1), cumul_eur: 440 * (i + 1) - 10000 }));
  const vm = pdf(mapScenarioToV2(input, {}));
  const numeric = (value) => Number(String(value).replace(/[^\d-]/g, ""));
  assert.equal(numeric(vm.fullReport.p2.p2_auto.p2_sans_solaire), 25000);
  assert.equal(numeric(vm.fullReport.p2.p2_auto.p2_avec_solaire), 16250);
  assert.equal(numeric(vm.fullReport.p2.p2_auto.p2_economie_totale), 8750);
});

test("sans nouveau ledger, la revente reste séparée de la facture fournisseur", () => {
  const mapped = mapScenarioToV2(scenario(undefined), {});
  assert.equal(mapped.finance.estimated_annual_bill_eur, 450);
});
