import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarioElectricitySnapshotFields, getScenarioElectricityBilling } from "../services/scenarioElectricitySnapshot.service.js";
import { repairScenarioV2DisplayKpis } from "../services/scenarioV2DisplayRepair.service.js";
import { putEphemeralSnapshot, getEphemeralSnapshot } from "../services/pdfEphemeralSnapshot.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

function scenarioFixture(status) {
  const complete = status === "FULL";
  return {
    id: "BATTERY_VIRTUAL", name: "BATTERY_VIRTUAL",
    energy: { production_kwh: 5000, consumption_kwh: 8000, autoconsumption_kwh: 2500, import_kwh: 3000, billable_import_kwh: 3000, surplus_kwh: 0 },
    production: { annual_kwh: 5000, monthly_kwh: Array(12).fill(5000 / 12) },
    virtual_battery_finance: { provider_code: "URBAN_SOLAR", annual_subscription_ttc: 150, annual_virtual_discharge_cost_ttc: 90, annual_autoproducer_contribution_ttc: 12, annual_total_virtual_cost_ttc: 252 },
    finance: {
      capex_ttc: 10000, economie_year_1: 1160, economie_total: 15000, roi_years: 10, irr_pct: 5,
      annual_cashflows: [{ year: 1, total_eur: 1160, cumul_eur: -8840 }],
      electricity_billing: {
        schema_version: 1, status,
        missing_fields: complete ? [] : ["CURRENT_SUPPLIER_SUBSCRIPTION"],
        current_contract: { provider_code: "EDF", contract_type: "HPHC", price_hp_eur_kwh: 0.3, price_hc_eur_kwh: 0.13, off_peak_periods: [{ start: "22:30", end: "06:30" }] },
        scenario_contract: { provider_code: "URBAN_SOLAR", contract_type: "BASE", price_base_eur_kwh: 0.2, subscription_includes_autoproducer_contribution: true },
        bill_before_eur: complete ? 2240 : null,
        bill_after_eur: complete ? 1080 : null,
        bill_savings_eur: complete ? 1160 : null,
        scenario_energy_purchase_eur: 600,
        scenario_supplier_subscription_eur: 240,
        virtual_service_cost_eur: 240,
      },
    },
  };
}

test("document fields clone the calculated ledger and never invent a missing contract", () => {
  assert.deepEqual(buildScenarioElectricitySnapshotFields({}), { electricity_billing: null, finance: {} });
  const scenario = scenarioFixture("FULL");
  const fields = buildScenarioElectricitySnapshotFields(scenario);
  scenario.finance.electricity_billing.current_contract.price_hp_eur_kwh = 9;
  assert.equal(fields.electricity_billing.current_contract.price_hp_eur_kwh, 0.3);
  assert.equal(fields.finance.electricity_billing.current_contract.price_hp_eur_kwh, 0.3);
  assert.equal(fields.finance.estimated_annual_bill_eur, 1080);
  assert.equal(getScenarioElectricityBilling({ finance_meta: { electricity_billing: fields.electricity_billing } }).status, "FULL");
});

for (const status of ["FULL", "INCOMPLETE"]) {
  test(`${status} ledger survives snapshot storage and PDF with changed live tariffs`, () => {
    const scenario = scenarioFixture(status);
    const before = structuredClone(scenario);
    const repaired = repairScenarioV2DisplayKpis([scenario])[0];
    assert.deepEqual(repaired, before, "legacy display repair must not rewrite calculated bills");
    const fields = buildScenarioElectricitySnapshotFields(repaired);
    const snapshot = {
      scenario_type: "BATTERY_VIRTUAL", scenario_result: structuredClone(repaired),
      client: { full_name: "Client test" }, site: {},
      installation: { puissance_kwc: 6, panneaux_nombre: 12 },
      equipment: { panneau: {}, onduleur: {}, batterie: {} },
      // This finance persistence test starts with an assessed shading result.
      shading: { assessment: { status: "computed", nearStatus: "computed", farStatus: "computed" }, near: { totalLossPct: 0 }, far: { totalLossPct: 0 }, combined: { totalLossPct: 0 } },
      energy: repaired.energy, production: repaired.production,
      finance: { ...repaired.finance, ...fields.finance },
      electricity_billing: fields.electricity_billing,
      cashflows: status === "FULL" ? [{ year: 1, gain: 1160, cumul: -8840 }] : [],
    };
    const id = putEphemeralSnapshot(snapshot, "BATTERY_VIRTUAL");
    snapshot.electricity_billing.current_contract.price_hp_eur_kwh = 8;
    const frozen = getEphemeralSnapshot(id).snapshot;
    const changed = scenarioFixture("FULL");
    changed.finance.electricity_billing.bill_after_eur = 99999;
    changed.finance.electricity_billing.current_contract.price_hp_eur_kwh = 7;
    const vm = mapSelectedScenarioSnapshotToPdfViewModel(frozen, {
      selected_scenario_id: "BATTERY_VIRTUAL",
      org_economics: { price_eur_kwh: 6, horizon_years: 25 },
      scenarios_v2: [changed],
    });
    assert.equal(vm.electricity_billing.status, status);
    assert.equal(vm.electricity_billing.current_contract.price_hp_eur_kwh, 0.3);
    assert.equal(vm.electricity_billing.bill_after_eur, status === "FULL" ? 1080 : null);
    assert.equal(vm.electricity_billing.scenario_energy_purchase_eur, 600);
    if (status === "INCOMPLETE") {
      assert.equal(frozen.finance.economie_year_1, null);
      assert.equal(frozen.finance.economie_total, null);
      assert.equal(frozen.finance.roi_years, null);
      assert.equal(vm.meta.financial_status, "INCOMPLETE");
    }
    frozen.electricity_billing.current_contract.price_hp_eur_kwh = 5;
    assert.equal(getEphemeralSnapshot(id).snapshot.electricity_billing.current_contract.price_hp_eur_kwh, 0.3);
  });
}
