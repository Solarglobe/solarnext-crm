import assert from "node:assert/strict";
import test from "node:test";

import { getEconomicSnapshotBlockingWarnings } from "../controllers/pdfGeneration.controller.js";
import { computeFinance } from "../services/financeService.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

const originalEconomics = {
  price_eur_kwh: 0.2,
  elec_growth_pct: 2,
  pv_degradation_pct: 0.5,
  oa_rate_lt_9: 0.01234,
  oa_rate_gte_9: 0.055,
  prime_lt9: 80,
  prime_gte9: 180,
  horizon_years: 25,
  maintenance_pct: 0,
  onduleur_year: 15,
  onduleur_cost_pct: 12,
  battery_degradation_pct: 2,
};

const mutatedEconomics = {
  price_eur_kwh: 0.99,
  elec_growth_pct: 9,
  pv_degradation_pct: 9,
  oa_rate_lt_9: 0.09999,
  oa_rate_gte_9: 0.08888,
  prime_lt9: 999,
  prime_gte9: 888,
  horizon_years: 30,
  maintenance_pct: 4,
  onduleur_year: 3,
  onduleur_cost_pct: 80,
  battery_degradation_pct: 9,
};

async function buildTraceabilityVm() {
  const ctx = {
    settings: {
      economics_raw: originalEconomics,
      economics: originalEconomics,
    },
    form: {},
    finance_input: {
      capex_ttc: 10000,
      economic_snapshot_config: {
        totals: { ttc: 10000 },
        financing: {
          amount: 10000,
          duration_months: 120,
          interest_rate_annual: 5,
          taeg_pct: 5.4,
          insurance_eur: 0,
          application_fee_eur: 0,
        },
      },
    },
  };

  const finance = await computeFinance(ctx, {
    BASE: {
      _v2: true,
      id: "BASE",
      name: "BASE",
      kwc: 6,
      prod_kwh: 7200,
      auto_kwh: 3200,
      surplus_kwh: 4000,
      conso_kwh: 12000,
      energy: {
        production_kwh: 7200,
        consumption_kwh: 12000,
        autoconsumption_kwh: 3200,
        surplus_kwh: 4000,
        import_kwh: 8800,
      },
    },
  });

  const computed = finance.scenarios.BASE;
  const frozen = computed.finance_meta.economic_snapshot;
  const snapshot = {
    scenario_type: "BASE",
    created_at: "2026-07-07T10:00:00.000Z",
    economic_snapshot: frozen,
    client: { full_name: "Client Test" },
    site: {},
    installation: { puissance_kwc: 6, panneaux_nombre: 12 },
    equipment: { panneau: {}, onduleur: {}, batterie: {} },
    shading: {},
    energy: {
      production_kwh: 7200,
      consumption_kwh: 12000,
      autoconsumption_kwh: 3200,
      surplus_kwh: 4000,
      import_kwh: 8800,
    },
    production: { annual_kwh: 7200, monthly_kwh: Array(12).fill(600) },
    finance: {
      capex_ttc: computed.capex_ttc,
      prime_eur: computed.prime_eur,
      economie_year_1: computed.economie_an1,
      economie_total: computed.economie_25a,
      economie_horizon_years: computed.economie_horizon_years,
      finance_meta: computed.finance_meta,
      roi_years: computed.roi_years,
      irr_pct: computed.irr_pct,
      revenu_surplus: 49,
    },
    cashflows: Array.isArray(computed.flows)
      ? computed.flows.map((f) => ({
          year: f.year,
          gain: f.total_eur,
          cumul: f.cumul_eur,
          cumul_gains: f.cumul_gains_eur,
        }))
      : [],
  };

  const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    selected_scenario_id: "BASE",
    org_economics: mutatedEconomics,
    economic_snapshot_config: {
      totals: { ttc: 99999 },
      financing: {
        amount: 99999,
        duration_months: 240,
        interest_rate_annual: 12,
        taeg_pct: 12.5,
        insurance_eur: 999,
        application_fee_eur: 999,
      },
    },
    scenarios_v2: [
      {
        id: "BASE",
        name: "BASE",
        energy: { ...snapshot.energy, production_kwh: 999999 },
        production: { annual_kwh: 999999, monthly_kwh: Array(12).fill(83333) },
        finance: {
          ...snapshot.finance,
          capex_ttc: 99999,
          prime_eur: 5994,
          economie_year_1: 99999,
          economie_total: 999999,
          roi_years: 1,
          irr_pct: 99,
          annual_cashflows: computed.flows,
        },
      },
    ],
  });

  return { vm, frozen, computed };
}

test("PDF keeps frozen OA, price, indexation, prime, CAPEX and residual charge", async () => {
  const { vm, frozen, computed } = await buildTraceabilityVm();

  assert.equal(frozen.oa_rate_eur_kwh, 0.01234);
  assert.equal(frozen.price_eur_kwh, 0.2);
  assert.equal(frozen.prime_eur, 480);
  assert.equal(frozen.capex_ttc, 10000);
  assert.equal(frozen.reste_a_charge_eur, 9520);
  assert.ok(frozen.hash);

  assert.equal(vm.fullReport.p2.p2_auto.p2_surplus_rate, "0,012 \u20ac/kWh");
  assert.equal(vm.fullReport.p2.p2_auto.p2_price_kwh, "0,200 \u20ac/kWh");
  assert.equal(vm.fullReport.p2.p2_auto.p2_indexation, "2,0 %/an");
  assert.equal(vm.fullReport.p2.p2_auto.p2_prime_raw_eur, 480);
  assert.equal(vm.fullReport.p2.p2_auto.p2_investissement_ttc_raw_eur, 10000);
  assert.equal(vm.fullReport.p2.p2_auto.p2_reste_charge_raw_eur, 9520);
  assert.equal(vm.fullReport.p3.offer.total_ttc, 10000);
  assert.equal(vm.fullReport.p3.offer.reste, 9520);

  assert.equal(vm.fullReport.p10.hyp.oa_price, 0.01234);
  assert.equal(vm.fullReport.p10.hyp.price_kwh, 0.2);
  assert.equal(vm.fullReport.p10.hyp.horizon_years, 25);
  assert.equal(vm.fullReport.p10.hyp.prime_autoconso_eur, 480);
  assert.equal(vm.economics.capex, 10000);
  assert.equal(vm.economics.roiYears, computed.roi_years);
  assert.equal(vm.economics.tri, computed.irr_pct);
  assert.notEqual(vm.economics.tri, 99);
  assert.notEqual(vm.economics.roiYears, 1);
  assert.equal(vm.fullReport.p1.p1_auto.p1_k_gains, `${Math.round(computed.economie_25a).toLocaleString("fr-FR")} \u20ac`);
  assert.equal(vm.fullReport.p10.best.gains_25_eur, computed.economie_25a);
  assert.equal(vm.fullReport.p10.best.annual_production_kwh, 7200);
  assert.notEqual(vm.fullReport.p10.best.annual_production_kwh, 999999);
  assert.equal(Math.round(vm.fullReport.p9.scenario.final_cumul), Math.round(computed.economie_25a));
  assert.notEqual(vm.fullReport.p9.scenario.final_cumul, 999999);
  assert.equal(vm.fullReport.p2.p2_auto.p2_economie_nette, `${Math.round(computed.economie_25a).toLocaleString("fr-FR")} \u20ac`);
});

test("PDF keeps frozen financing when current quote financing changes", async () => {
  const { vm } = await buildTraceabilityVm();
  const financing = vm.fullReport.p11.data.financing;

  assert.equal(financing.enabled, true);
  assert.equal(financing.duration_months, 120);
  assert.equal(financing.taeg_display, "5,0 %");
  assert.equal(financing.montant_finance_display, "10\u202f000 \u20ac");
  assert.notEqual(financing.duration_months, 240);
  assert.notEqual(financing.montant_finance_display, "99\u202f999 \u20ac");
});

test("PDF final is blocked for old or incomplete economic snapshots", () => {
  assert.deepEqual(getEconomicSnapshotBlockingWarnings({}), ["ECONOMIC_SNAPSHOT_MISSING"]);
  assert.deepEqual(getEconomicSnapshotBlockingWarnings({ economic_snapshot: null }), ["ECONOMIC_SNAPSHOT_MISSING"]);

  const warnings = getEconomicSnapshotBlockingWarnings({
    economic_snapshot: {
      price_eur_kwh: 0.2,
      elec_growth_pct: 2,
      horizon_years: 25,
      oa_rate_eur_kwh: 0.01234,
      prime_eur: 480,
      capex_ttc: 10000,
      blocking_warnings: ["ECONOMIC_ASSUMPTION_NOT_TRACEABLE:prime_lt9"],
    },
  });

  assert.deepEqual(warnings, [
    "ECONOMIC_ASSUMPTION_NOT_TRACEABLE:prime_lt9",
    "ECONOMIC_ASSUMPTION_MISSING:reste_a_charge_eur",
  ]);
});
