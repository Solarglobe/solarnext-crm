/**
 * Test impact financier batterie physique et virtuelle (moteur scénarios V2).
 * Vérifie : BASE.capex_ttc < BATTERY_PHYSICAL.capex_ttc, BATTERY_VIRTUAL cashflow < BASE, ROI distincts.
 * Usage: node backend/scripts/test-battery-finance.js
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
  finance_input: { capex_ttc: 14694, battery_physical_price_ttc: 3500 },
  settings: {
    economics: {
      price_eur_kwh: 0.2,
      elec_growth_pct: 5,
      pv_degradation_pct: 0.5,
      oa_rate_lt_9: 0.04,
      oa_rate_gte_9: 0.0617,
      prime_lt9: 80,
      prime_gte9: 180,
      horizon_years: 25,
      maintenance_pct: 0,
      onduleur_year: 15,
      onduleur_cost_pct: 12,
    },
  },
};

// BASE
const base = { ...baseScenario };

// BATTERY_PHYSICAL : CAPEX résolu uniquement depuis finance_input (PV + battery_physical_price_ttc)
const batteryPhysicalPriceTtc = 3500;
const physicalScenario = {
  ...baseScenario,
  name: "BATTERY_PHYSICAL",
  battery: true,
  batterie: true,
  _v2: true
};

// BATTERY_VIRTUAL : même capex que BASE, OPEX annuel (fee_fixed_ttc année 1 uniquement)
const virtualScenario = {
  ...baseScenario,
  name: "BATTERY_VIRTUAL",
  battery: "virtual",
  batterie: "virtual",
  _v2: true,
  _virtualBatteryQuote: {
    annual_cost_ttc: 600,
    detail: { fee_fixed_ttc: 120 },
  },
};

const scenarios = {
  BASE: base,
  BATTERY_PHYSICAL: physicalScenario,
  BATTERY_VIRTUAL: virtualScenario,
};

const result = await computeFinance(baseCtx, scenarios);

const BASE = result.scenarios.BASE;
const PHYSICAL = result.scenarios.BATTERY_PHYSICAL;
const VIRTUAL = result.scenarios.BATTERY_VIRTUAL;

assert(BASE != null && PHYSICAL != null && VIRTUAL != null, "Les 3 scénarios doivent exister");

// NO CHANGE énergétique : production et autoconsommation identiques entre scénarios (finance seule modifiée)
const baseProd = BASE.prod_kwh ?? BASE.energy?.prod ?? 0;
const baseAuto = BASE.auto_kwh ?? BASE.energy?.auto ?? 0;
const physProd = PHYSICAL.prod_kwh ?? PHYSICAL.energy?.prod ?? 0;
const physAuto = PHYSICAL.auto_kwh ?? PHYSICAL.energy?.auto ?? 0;
const virtProd = VIRTUAL.prod_kwh ?? VIRTUAL.energy?.prod ?? 0;
const virtAuto = VIRTUAL.auto_kwh ?? VIRTUAL.energy?.auto ?? 0;
assert(baseProd === physProd && baseProd === virtProd, `production_kwh identique entre scénarios (BASE=${baseProd}, PHYS=${physProd}, VIRT=${virtProd})`);
assert(baseAuto === physAuto && baseAuto === virtAuto, `autoconsumption_kwh identique entre scénarios (BASE=${baseAuto}, PHYS=${physAuto}, VIRT=${virtAuto})`);
console.log("✅ NO CHANGE énergétique : production_kwh et autoconsumption_kwh identiques entre BASE / BATTERY_PHYSICAL / BATTERY_VIRTUAL");

// BASE.capex_ttc < BATTERY_PHYSICAL.capex_ttc
assert(
  BASE.capex_ttc != null && PHYSICAL.capex_ttc != null && PHYSICAL.capex_ttc > BASE.capex_ttc,
  `BATTERY_PHYSICAL.capex_ttc (${PHYSICAL.capex_ttc}) doit être > BASE.capex_ttc (${BASE.capex_ttc})`
);
console.log("✅ BASE.capex_ttc < BATTERY_PHYSICAL.capex_ttc", BASE.capex_ttc, "<", PHYSICAL.capex_ttc);

// BATTERY_VIRTUAL cashflow année 1 < BASE cashflow année 1 (OPEX virtuel)
const baseCashflowY1 = BASE.flows?.[0]?.total_eur ?? 0;
const virtualCashflowY1 = VIRTUAL.flows?.[0]?.total_eur ?? 0;
assert(
  virtualCashflowY1 < baseCashflowY1,
  `BATTERY_VIRTUAL.cashflow_year1 (${virtualCashflowY1}) doit être < BASE.cashflow_year1 (${baseCashflowY1})`
);
console.log("✅ BATTERY_VIRTUAL.cashflow_year1 < BASE.cashflow_year1", virtualCashflowY1, "<", baseCashflowY1);

// roi_years BASE ≠ roi_years BATTERY_VIRTUAL (quand les deux sont définis)
if (BASE.roi_years != null && VIRTUAL.roi_years != null) {
  assert(
    Number(BASE.roi_years) !== Number(VIRTUAL.roi_years),
    `ROI BASE (${BASE.roi_years}) et BATTERY_VIRTUAL (${VIRTUAL.roi_years}) doivent différer`
  );
  console.log("✅ roi_years BASE ≠ roi_years BATTERY_VIRTUAL", BASE.roi_years, "≠", VIRTUAL.roi_years);
} else {
  console.log("ℹ roi_years BASE ou VIRTUAL null — skip comparaison");
}

// Optionnel : roi_years BASE ≠ roi_years BATTERY_PHYSICAL (CAPEX plus élevé → ROI plus long)
if (BASE.roi_years != null && PHYSICAL.roi_years != null) {
  assert(
    Number(PHYSICAL.roi_years) >= Number(BASE.roi_years),
    `ROI BATTERY_PHYSICAL (${PHYSICAL.roi_years}) doit être >= BASE (${BASE.roi_years})`
  );
  console.log("✅ roi_years BATTERY_PHYSICAL >= BASE", PHYSICAL.roi_years, ">=", BASE.roi_years);
}

console.log("\n✅ test-battery-finance.js — tous les tests passent.");
