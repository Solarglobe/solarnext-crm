/**
 * Virtual battery setup fee must be a one-time expense outside PV CAPEX, not annual OPEX.
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

test("BATTERY_VIRTUAL setup fee is paid once outside PV CAPEX and recurring costs", async () => {
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
  const makeVirtual = (virtualSetupFee) => makeScenario("BATTERY_VIRTUAL", {
    capex_ttc: 0,
    pvInstallationPrice: 6800,
    virtualSetupFee,
    virtualAnnualFees: 285.04,
    billable_import_kwh: 7589,
    _virtual_battery_activation_in_capex: false,
    virtual_battery_finance: {
      provider_code: "URBAN_SOLAR",
      annual_subscription_ttc: 36,
      annual_autoproducer_contribution_ttc: 12,
      annual_virtual_discharge_cost_ttc: 237.04,
      annual_activation_fee_ttc: 0,
      one_time_setup_fee_ttc: virtualSetupFee,
      annual_total_virtual_cost_ttc: 285.04,
      annual_overflow_export_revenue_ttc: 0,
    },
  });

  const result = await computeFinance(ctx, { BASE: base, BATTERY_VIRTUAL: makeVirtual(299) });
  const control = await computeFinance(ctx, { BASE: makeScenario("BASE"), BATTERY_VIRTUAL: makeVirtual(0) });
  const out = result.scenarios.BATTERY_VIRTUAL;
  const withoutSetupFee = control.scenarios.BATTERY_VIRTUAL;

  assert.equal(out.capex_ttc, 6800);
  assert.equal(out.pvInstallationPrice, 6800);
  assert.equal(out.virtualSetupFee, 299);
  assert.equal(out.virtualAnnualFees, 285.04);
  assert.equal(out.virtual_battery_finance.annual_total_virtual_cost_ttc, 285.04);
  assert.equal(out.virtual_battery_finance.annual_activation_fee_ttc, 0);
  assert.equal(Math.round((withoutSetupFee.flows[0].total_eur - out.flows[0].total_eur) * 100) / 100, 299);
  for (let i = 1; i < out.flows.length; i++) assert.equal(out.flows[i].total_eur, withoutSetupFee.flows[i].total_eur);
  assert.ok(out.irr_pct < withoutSetupFee.irr_pct);
  assert.equal(Math.round((withoutSetupFee.gain_25a - out.gain_25a) * 100) / 100, 299);
  // No confirmed surplus-sale contract: no invented OA income on top of the
  // credited energy. Year two also pays restitution on the degraded volume.
  assert.equal(out.flows[0].gain_oa, 0);
  assert.equal(Math.round(out.flows[0].total_eur * 100) / 100, 81.11);
  const year2Credit = 2449 * 0.995;
  const year2Service = 48 + year2Credit * (237.04 / 2449);
  assert.equal(Math.round(out.flows[1].virtual_service_cost_eur * 100) / 100, Math.round(year2Service * 100) / 100);
  assert.equal(Math.round(out.flows[1].total_eur * 100) / 100, Math.round((3411 * 0.995 * 0.195 * 1.05 - year2Service) * 100) / 100);
  assert.doesNotMatch(JSON.stringify(out), /offerts|pris en charge par SolarGlobe|inclus dans l'investissement/i);
});
