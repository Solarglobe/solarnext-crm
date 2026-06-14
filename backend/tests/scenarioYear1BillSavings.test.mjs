import assert from "node:assert/strict";
import test from "node:test";

import { computeFinance } from "../services/financeService.js";

function baseCtx() {
  return {
    form: {
      params: { tarif_kwh: 0.2 },
      economics: {
        horizon_years: 25,
        elec_growth_pct: 0,
        pv_degradation_pct: 0,
        oa_rate_lt_9: 0.1,
        oa_rate_gte_9: 0.08,
        prime_lt9: 0,
        prime_gte9: 0,
        maintenance_pct: 1,
        onduleur_year: 15,
        onduleur_cost_pct: 10,
      },
      pv_inverter: { type: "string" },
    },
    finance_input: {
      capex_ttc: 10000,
      battery_physical_price_ttc: 3000,
    },
    settings: {},
  };
}

function baseScenario(overrides = {}) {
  return {
    _v2: true,
    name: "BASE",
    kwc: 6,
    prod_kwh: 6000,
    conso_kwh: 10000,
    auto_kwh: 4000,
    surplus_kwh: 2000,
    import_kwh: 6000,
    residual_bill_eur: 1200,
    energy: {
      production_kwh: 6000,
      consumption_kwh: 10000,
      autoconsumption_kwh: 4000,
      surplus: 2000,
      import_kwh: 6000,
      energy_grid_import_kwh: 6000,
    },
    ...overrides,
  };
}

test("economie_an1 is bill savings, not net cashflow with maintenance or capex effects", async () => {
  const out = await computeFinance(baseCtx(), {
    BASE: baseScenario(),
    BATTERY_PHYSICAL: baseScenario({
      name: "BATTERY_PHYSICAL",
      auto_kwh: 7000,
      surplus_kwh: 1000,
      import_kwh: 3000,
      residual_bill_eur: 600,
      energy: {
        production_kwh: 6000,
        consumption_kwh: 10000,
        autoconsumption_kwh: 7000,
        surplus: 1000,
        import_kwh: 3000,
        energy_grid_import_kwh: 3000,
      },
      battery: { annual_discharge_kwh: 2000 },
    }),
    BATTERY_HYBRID: baseScenario({
      name: "BATTERY_HYBRID",
      auto_kwh: 7000,
      surplus_kwh: 1000,
      import_kwh: 3000,
      billable_import_kwh: 3000,
      residual_bill_eur: 600,
      energy: {
        production_kwh: 6000,
        consumption_kwh: 10000,
        autoconsumption_kwh: 7000,
        surplus: 1000,
        import_kwh: 3000,
        billable_import_kwh: 3000,
        energy_grid_import_kwh: 3000,
      },
      battery: { annual_discharge_kwh: 2000 },
      virtual_battery_finance: {
        annual_grid_import_cost_ttc: 600,
        annual_total_virtual_cost_ttc: 150,
        annual_overflow_export_revenue_ttc: 0,
      },
    }),
  });

  assert.equal(out.scenarios.BASE.economie_an1, 800);
  assert.equal(out.scenarios.BATTERY_PHYSICAL.economie_an1, 1400);
  assert.equal(out.scenarios.BATTERY_HYBRID.economie_an1, 1250);

  assert.notEqual(
    out.scenarios.BATTERY_PHYSICAL.economie_an1,
    Math.round(out.scenarios.BATTERY_PHYSICAL.flows[0].total_eur),
    "annual bill savings must not reuse net cashflow"
  );
  assert.equal(
    out.scenarios.BATTERY_PHYSICAL.finance_meta.economie_an1_definition,
    "bill_before_solar_minus_bill_after_solar_year1"
  );
});
