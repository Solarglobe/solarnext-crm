/**
 * Test injection CAPEX depuis finance_input (devis technique = source unique).
 * Usage: node backend/scripts/test-finance-capex-injection.js
 */

import { computeFinance } from "../services/financeService.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const baseScenario = {
  name: "BASE",
  _v2: true,
  kwc: 6,
  battery: false,
  prod_kwh: 6000,
  auto_kwh: 3000,
  surplus_kwh: 3000,
  conso_kwh: 5000,
};

const baseCtx = {
  form: { params: { tarif_kwh: 0.2 } },
  settings: {
    economics: {
      price_eur_kwh: 0.2,
      elec_growth_pct: 5,
      pv_degradation_pct: 0.5,
      oa_rate_lt_9: 0.0762,   // S24 — aligné sur orgEconomics.common.js
      oa_rate_gte_9: 0.0606,  // S24 — aligné sur orgEconomics.common.js
      prime_lt9: 80,
      prime_gte9: 180,
      horizon_years: 25,
      maintenance_pct: 0,
      onduleur_year: 15,
      onduleur_cost_pct: 12,
    },
  },
};

// ——— Test 1 : Sans capex (finance_input absent) ———
const ctxNoCapex = { ...baseCtx, finance_input: null };
const scenariosNoCapex = { BASE: { ...baseScenario } };
const outNoCapex = await computeFinance(ctxNoCapex, scenariosNoCapex);
const baseNoCapex = outNoCapex.scenarios.BASE;

assert(baseNoCapex != null, "BASE doit exister");
assert(baseNoCapex.capex_ttc === null, "Sans capex : capex_ttc doit être null");
assert(baseNoCapex.roi_years === null, "Sans capex : roi_years doit être null");
assert(baseNoCapex.irr_pct === null, "Sans capex : irr_pct doit être null");
assert(baseNoCapex.flows === null, "Sans capex : flows doit être null");
console.log("✅ Test 1 — Sans capex : ROI/IRR/cashflows = null");

// ——— Test 2 : Avec capex injecté (18000 €) ———
const ctxWithCapex = {
  ...baseCtx,
  finance_input: { capex_ttc: 18000 },
};
const scenariosWithCapex = { BASE: { ...baseScenario } };
const outWithCapex = await computeFinance(ctxWithCapex, scenariosWithCapex);
const baseWithCapex = outWithCapex.scenarios.BASE;

assert(baseWithCapex != null, "BASE doit exister");
assert(baseWithCapex.capex_ttc === 18000, "Avec capex : capex_ttc = 18000");
assert(Array.isArray(baseWithCapex.flows), "Avec capex : flows doit être un tableau");
assert(baseWithCapex.flows.length === 25, "Avec capex : 25 années de cashflows");
assert(typeof baseWithCapex.roi_years === "number" || baseWithCapex.roi_years === null, "roi_years nombre ou null");
assert(typeof baseWithCapex.irr_pct === "number" || baseWithCapex.irr_pct === null, "irr_pct nombre ou null");
assert(baseWithCapex.economie_an1 != null, "economie_an1 calculée");
assert(baseWithCapex.gain_25a != null, "gain_25a calculé");
const y1Net = baseWithCapex.flows[0].cumul_eur;
assert(
  y1Net != null && Number.isFinite(y1Net) && y1Net < 0,
  "année 1 : cumul_eur (net après CAPEX TTC) doit être < 0",
);
assert(
  baseWithCapex.flows[0].cumul_gains_eur != null &&
    baseWithCapex.flows[0].cumul_gains_eur === baseWithCapex.flows[0].total_eur,
  "cumul_gains_eur année 1 = total_eur",
);
console.log("✅ Test 2 — Avec capex 18000 : ROI =", baseWithCapex.roi_years, "| IRR =", baseWithCapex.irr_pct, "% | flows.length =", baseWithCapex.flows.length);

console.log("\n✅ test-finance-capex-injection.js — tous les tests passent.");
