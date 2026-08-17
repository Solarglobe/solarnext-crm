import assert from "node:assert/strict";
import test from "node:test";

import {
  computeProjectEconomicTotalsFromConfig,
  enrichInstallerCostWithVat,
} from "../services/projectEconomicTotals.service.js";
import { computeFinance } from "../services/financeService.js";

function baseScenario() {
  return {
    name: "BASE",
    id: "BASE",
    _v2: true,
    kwc: 6,
    prod_kwh: 7000,
    auto_kwh: 3500,
    surplus_kwh: 3500,
    conso_kwh: 9000,
    energy: {
      production_kwh: 7000,
      consumption_kwh: 9000,
      autoconsumption_kwh: 3500,
      surplus_kwh: 3500,
      import_kwh: 5500,
    },
  };
}

function financeCtx(capexTtc) {
  return {
    form: {
      params: { tarif_kwh: 0.24 },
      economics: {
        price_eur_kwh: 0.24,
        elec_growth_pct: 2,
        pv_degradation_pct: 0.5,
        oa_rate_lt_9: 0.13,
        oa_rate_gte_9: 0.078,
        prime_lt9: 80,
        prime_gte9: 80,
        horizon_years: 25,
        maintenance_pct: 1,
        onduleur_year: 12,
        onduleur_cost_pct: 8,
      },
    },
    finance_input: { capex_ttc: capexTtc },
    settings: {},
  };
}

test("totaux projet: SolarGlobe 10000 TTC + installateur 2000 TTC => CAPEX 12000", async () => {
  const installerCost = enrichInstallerCostWithVat(
    {
      installer: { id: "installer-ohelec", name: "OHELEC" },
      final_total_ht_cents: 166667,
    },
    20
  );
  assert.equal(installerCost.final_total_ttc_cents, 200000);

  const totals = computeProjectEconomicTotalsFromConfig({
    totals: { ht: 8333.33, tva: 1666.67, ttc: 10000 },
    installer_cost: installerCost,
  });

  assert.equal(totals.solarglobe.ttc, 10000);
  assert.equal(totals.installer.ttc, 2000);
  assert.equal(totals.project.ttc, 12000);

  const finance = await computeFinance(financeCtx(totals.project.ttc), { BASE: baseScenario() });
  const sc = finance.scenarios.BASE;

  assert.equal(sc.capex_ttc, 12000);
  assert.equal(sc.flows[0].cumul_eur, -12000 + sc.flows[0].total_eur);
  assert.deepEqual(sc.flows ? [-sc.capex_ttc, ...sc.flows.map((f) => f.total_eur)].slice(0, 1) : [], [-12000]);
  assert.notEqual(sc.capex_ttc, 10000);
  assert.ok(sc.roi_years == null || sc.roi_years >= 1);
  assert.ok(sc.irr_pct == null || Number.isFinite(Number(sc.irr_pct)));
});

test("totaux projet: sans installateur, le CAPEX reste le total SolarGlobe", () => {
  const totals = computeProjectEconomicTotalsFromConfig({
    totals: { ht: 8333.33, tva: 1666.67, ttc: 10000 },
  });

  assert.equal(totals.installer.ttc, 0);
  assert.equal(totals.project.ttc, 10000);
});

test("historisation: les totaux utilisent le snapshot installer_cost, pas une valeur catalogue live future", () => {
  const frozenInstallerCost = enrichInstallerCostWithVat(
    {
      installer: { id: "installer-ohelec", name: "OHELEC" },
      final_total_ht_cents: 166667,
    },
    20
  );
  const futureCatalogValue = 999999;
  const totals = computeProjectEconomicTotalsFromConfig({
    totals: { ht: 8333.33, tva: 1666.67, ttc: 10000 },
    installer_cost: frozenInstallerCost,
    future_catalog_value_ht_cents: futureCatalogValue,
  });

  assert.equal(totals.installer.ttc, 2000);
  assert.equal(totals.project.ttc, 12000);
});
