/**
 * Croissance prix elec : source unique admin + fallback visible.
 * Usage: node backend/tests/electricityGrowthSource.test.js
 */

import { computeFinance } from "../services/financeService.js";
import { buildCalculationConfidenceFromCalc } from "../services/calculationConfidence.service.js";
import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "../services/pdf/pdfViewModel.mapper.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const approx = (a, b, msg, eps = 1e-6) => {
  if (Math.abs(Number(a) - Number(b)) > eps) {
    throw new Error(`${msg}: attendu ${b}, recu ${a}`);
  }
};

const baseEconomics = {
  price_eur_kwh: 0.2,
  elec_growth_pct: 2,
  pv_degradation_pct: 0,
  oa_rate_lt_3: 0.1305,
  oa_rate_lt_9: 0.0762,
  oa_rate_gte_9: 0.0606,
  prime_lt9: 0,
  prime_gte9: 0,
  horizon_years: 3,
  maintenance_pct: 1,
  onduleur_year: 15,
  onduleur_cost_pct: 12,
  battery_degradation_pct: 0,
};

const baseScenario = {
  name: "BASE",
  _v2: true,
  kwc: 6,
  prod_kwh: 6000,
  auto_kwh: 3000,
  surplus_kwh: 3000,
  conso_kwh: 5000,
};

async function financeFor(economics, formEconomics = {}) {
  return computeFinance(
    {
      form: { params: {}, economics: formEconomics },
      finance_input: { capex_ttc: 18000 },
      settings: { economics, economics_raw: economics },
    },
    { BASE: { ...baseScenario } }
  );
}

const admin2 = await financeFor({ ...baseEconomics, elec_growth_pct: 2 }, { elec_growth_pct: 4 });
const admin4 = await financeFor({ ...baseEconomics, elec_growth_pct: 4 });

const flows2 = admin2.scenarios.BASE.flows;
const flows4 = admin4.scenarios.BASE.flows;
approx(flows2[1].gain_auto, 3000 * 0.2 * 1.02, "admin=2 applique 2% en annee 2");
approx(flows4[1].gain_auto, 3000 * 0.2 * 1.04, "admin=4 applique 4% en annee 2");
assert(flows2[2].cumul_gains_eur !== flows4[2].cumul_gains_eur, "2% et 4% doivent diverger sur les cashflows");
assert(admin2.scenarios.BASE.finance_meta.elec_growth_pct === 2, "form.economics ne doit pas remplacer admin=2 par 4");
assert(!admin2.scenarios.BASE.finance_warnings.includes("ELEC_GROWTH_MISSING"), "admin=2 ne doit pas produire ELEC_GROWTH_MISSING");

const missing = await financeFor({ ...baseEconomics, elec_growth_pct: undefined });
assert(missing.scenarios.BASE.finance_warnings.includes("ELEC_GROWTH_MISSING"), "valeur absente => warning obligatoire");
assert(missing.scenarios.BASE.finance_meta.elec_growth_missing === true, "snapshot finance_meta marque le fallback");

const confidence = buildCalculationConfidenceFromCalc(
  {
    form: { economics: {} },
    settings: { economics: { ...baseEconomics, elec_growth_pct: undefined }, economics_raw: { ...baseEconomics, elec_growth_pct: undefined } },
    pv: { source: "PVGIS" },
    meta: { engine_consumption_source: "CSV_HOURLY" },
  },
  { BASE: missing.scenarios.BASE }
);
assert(confidence.non_blocking_warnings.includes("ELEC_GROWTH_MISSING"), "confidence expose ELEC_GROWTH_MISSING");
assert(confidence.level !== "HIGH", "confidence downgraded si croissance admin absente");

const mapped = mapScenarioToV2(admin2.scenarios.BASE, {
  pv: { panelsCount: 12, kwc: 6 },
  finance_input: { capex_ttc: 18000 },
});
assert(mapped.finance.finance_meta.elec_growth_pct === 2, "scenarios_v2 conserve elec_growth_pct");
assert(mapped.assumptions.elec_growth_pct === 2, "scenarios_v2 assumptions conserve elec_growth_pct");

const snapshot = {
  scenario_type: "BASE",
  client: {},
  site: {},
  installation: { puissance_kwc: 6, production_annuelle_kwh: 6000 },
  equipment: {},
  energy: { production_kwh: 6000, consumption_kwh: 5000, autoconsumption_kwh: 3000, surplus_kwh: 3000 },
  finance: {
    capex_ttc: 18000,
    economie_year_1: 700,
    economie_total: 2100,
    roi_years: 10,
    irr_pct: 4,
    finance_meta: { elec_growth_pct: 2, horizon_years: 3 },
  },
  production: { annual_kwh: 6000 },
  assumptions: { elec_growth_pct: 2 },
};

const vm = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
  selected_scenario_id: "BASE",
  org_economics: { ...baseEconomics, elec_growth_pct: 9 },
  scenarios_v2: [mapped],
});
assert(vm.fullReport.p10.hyp.elec_infl === 2, "PDF utilise la valeur snapshot, pas l'admin modifie apres");

console.log("electricityGrowthSource.test.js OK");
