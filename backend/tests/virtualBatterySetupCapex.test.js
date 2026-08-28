/**
 * Virtual battery setup fee must be a one-time CAPEX item, not annual OPEX.
 * Usage: node --test backend/tests/virtualBatterySetupCapex.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { computeFinance } from "../services/financeService.js";

function makeScenario(name, overrides = {}) {
  return {
    name,
    _v2: true,
    kwc: 3,
    prod_kwh: 3411,
    conso_kwh: 11000,
    auto_kwh: 962,
    surplus_kwh: 2449,
    import_kwh: name === "BATTERY_VIRTUAL" ? 7589 : 10038,
    energy: {
      prod: 3411,
      auto: 962,
      surplus: 2449,
      import: name === "BATTERY_VIRTUAL" ? 7589 : 10038,
      billable_import_kwh: name === "BATTERY_VIRTUAL" ? 7589 : undefined,
    },
    ...overrides,
  };
}

test("BATTERY_VIRTUAL investment equals PV installation plus one-time setup fee", async () => {
  const ctx = {
    finance_input: { capex_ttc: 6800 },
    settings: {
      economics: {
        horizon_years: 25,
        price_eur_kwh: 0.195,
        elec_growth_pct: 5,
        pv_degradation_pct: 0.5,
        maintenance_pct: 0,
        inverter_replacement_year: null,
        inverter_cost_pct: 0,
        prime_lt9: 0,
        prime_gte9: 0,
        oa_rate_lt_9: 0.011,
        oa_rate_gte_9: 0.011,
      },
    },
    form: { params: { tarif_kwh: 0.195 } },
  };
  const base = makeScenario("BASE");
  const virtual = makeScenario("BATTERY_VIRTUAL", {
    capex_ttc: 299,
    billable_import_kwh: 7589,
    _virtual_battery_activation_in_capex: true,
    virtual_battery_finance: {
      provider_code: "URBAN_SOLAR",
      annual_subscription_ttc: 36,
      annual_autoproducer_contribution_ttc: 12,
      annual_virtual_discharge_cost_ttc: 237.04,
      annual_activation_fee_ttc: 0,
      one_time_setup_fee_ttc: 299,
      annual_total_virtual_cost_ttc: 285.04,
      annual_overflow_export_revenue_ttc: 0,
    },
  });

  const result = await computeFinance(ctx, { BASE: base, BATTERY_VIRTUAL: virtual });
  const out = result.scenarios.BATTERY_VIRTUAL;

  assert.equal(out.capex_ttc, 7099);
  assert.equal(out.capex_ttc, ctx.finance_input.capex_ttc + virtual.virtual_battery_finance.one_time_setup_fee_ttc);
  assert.equal(out.virtual_battery_finance.annual_total_virtual_cost_ttc, 285.04);
  assert.equal(out.virtual_battery_finance.annual_activation_fee_ttc, 0);
  assert.equal(out.flows[0].cumul_eur, out.flows[0].cumul_gains_eur - 7099);
  assert.doesNotMatch(JSON.stringify(out), /offerts|pris en charge par SolarGlobe/i);
});
