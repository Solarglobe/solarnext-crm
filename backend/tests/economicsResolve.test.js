/**
 * Priorité hypothèses économiques (admin / surcharge / fallback).
 * node backend/tests/economicsResolve.test.js
 */

import {
  DEFAULT_ECONOMICS_FALLBACK,
  mergeOrgEconomicsPartial,
  pickExplicitProjectTariffKwh,
  resolveRetailElectricityKwhPrice,
  resolveOaRateForKwc,
} from "../services/economicsResolve.service.js";
import * as financeService from "../services/financeService.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ${b}, reçu ${a}`);
}

async function main() {
  console.log("=== economicsResolve.test.js ===\n");

  // TEST 5 legacy — org absent
  const m0 = mergeOrgEconomicsPartial(null);
  assert(m0.price_eur_kwh === DEFAULT_ECONOMICS_FALLBACK.price_eur_kwh, "merge null");
  assert(m0.battery_degradation_pct === 2, "battery def");

  // TEST 1 admin seul
  const m1 = mergeOrgEconomicsPartial({ price_eur_kwh: 0.22, horizon_years: 20 });
  assertApprox(m1.price_eur_kwh, 0.22, "prix org");
  assertApprox(m1.horizon_years, 20, "horizon org");
  assertApprox(m1.elec_growth_pct, DEFAULT_ECONOMICS_FALLBACK.elec_growth_pct, "croissance défaut");

  // TEST 3 champ absent étude — admin complète via merge
  const p = resolveRetailElectricityKwhPrice({
    form: { params: {} },
    settings: { economics: { price_eur_kwh: 0.31 } },
  });
  assertApprox(p, 0.31, "prix depuis settings seul");

  // TEST 2 surcharge locale params
  const p2 = resolveRetailElectricityKwhPrice({
    form: { params: { tarif_kwh: 0.17 } },
    settings: { economics: { price_eur_kwh: 0.31 } },
  });
  assertApprox(p2, 0.17, "params > admin");

  // form.economics partiel
  const p3 = resolveRetailElectricityKwhPrice({
    form: { params: {}, economics: { price_eur_kwh: 0.18 } },
    settings: { economics: { price_eur_kwh: 0.31 } },
  });
  assertApprox(p3, 0.18, "form.economics > admin");
  console.log("✅ TEST 1–3 priorité prix kWh");

  const oa = resolveOaRateForKwc(
    {
      form: { economics: { oa_rate_lt_9: 0.99, oa_rate_gte_9: 0.01 } },
      settings: { economics: {} },
    },
    6
  );
  assertApprox(oa, 0.99, "OA <9 depuis form.economics");

  const pickT = pickExplicitProjectTariffKwh({
    energyProfile: { summary: { price_eur_kwh: 0.44 } },
    economicSnapshot: null,
    studyData: null,
  });
  assertApprox(pickT, 0.44, "pick profil énergie");
  console.log("✅ pickExplicitProjectTariffKwh + OA");

  // TEST 4 battery_degradation via finance (indirect)
  const fin = await financeService.computeFinance(
    {
      form: { params: { tarif_kwh: 0.2 }, economics: { battery_degradation_pct: 5 } },
      finance_input: { capex_ttc: 12000, battery_physical_price_ttc: 3000 },
      settings: { economics: { battery_degradation_pct: 1 } },
    },
    {
      BASE: {
        name: "BASE",
        _v2: true,
        kwc: 6,
        prod_kwh: 5000,
        auto_kwh: 2000,
        surplus_kwh: 3000,
        conso_kwh: 5000,
      },
      BATTERY_PHYSICAL: {
        name: "BATTERY_PHYSICAL",
        _v2: true,
        kwc: 6,
        prod_kwh: 5000,
        auto_kwh: 2500,
        surplus_kwh: 2500,
        conso_kwh: 5000,
        battery: { annual_discharge_kwh: 500 },
      },
    }
  );
  assert(fin.scenarios.BATTERY_PHYSICAL.flows?.length > 0, "flows battery");
  console.log("✅ TEST 4 finance avec battery_degradation_pct (form > settings)");

  console.log("\n=== economicsResolve OK ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
