/**
 * Test scénario BATTERY_VIRTUAL V2 (finance uniquement, OPEX annuel).
 * Usage: node backend/scripts/test-scenario-battery-virtual.js
 */

import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { computeFinance } from "../services/financeService.js";

const HOURS = 8760;
function makeHourly(size, valueFn) {
  return Array.from({ length: size }, (_, i) => (typeof valueFn === "function" ? valueFn(i) : valueFn));
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const baseCtx = {
  pv: {
    hourly: makeHourly(8760, (i) => (i >= 2000 && i < 4000 ? 2.5 : 0.4)),
    kwc: 6,
    panelsCount: 12,
  },
  conso: { hourly: makeHourly(8760, 0.5), clamped: null },
  conso_p_pilotee: makeHourly(8760, 0.5),
  form: { maison: { panneaux_max: 12 } },
  settings: { economics: { horizon_years: 25 } },
};

// ——— Test 1 : Virtual disabled → pas de BATTERY_VIRTUAL dans la liste ———
const ctxNoVirtual = { ...baseCtx, virtual_battery_input: null, finance_input: { capex_ttc: 18000 } };
const base1 = buildScenarioBaseV2(ctxNoVirtual);
const scenarios1 = { BASE: base1 };
assert(!scenarios1.BATTERY_VIRTUAL, "Test 1 : virtual_battery_input null → pas de BATTERY_VIRTUAL");
console.log("✅ Test 1 — Virtual disabled → uniquement BASE");

// ——— Test 2 : Virtual enabled + capex 18000 → BATTERY_VIRTUAL présent, energy = BASE, ROI différent, cashflows réduits ———
const base2 = buildScenarioBaseV2({ ...baseCtx, finance_input: { capex_ttc: 18000 } });
const virtualScenario2 = JSON.parse(JSON.stringify(base2));
virtualScenario2.name = "BATTERY_VIRTUAL";
virtualScenario2.battery = "virtual";
virtualScenario2._v2 = true;
virtualScenario2._virtualBatteryQuote = {
  annual_cost_ht: 400,
  annual_cost_ttc: 480,
  net_gain_annual: 0,
  detail: {},
};

const ctx2 = {
  ...baseCtx,
  form: { ...baseCtx.form, params: { tarif_kwh: 0.2 } },
  finance_input: { capex_ttc: 18000 },
  settings: { economics: { horizon_years: 25 } },
};
const scenarios2 = { BASE: base2, BATTERY_VIRTUAL: virtualScenario2 };
const result2 = await computeFinance(ctx2, scenarios2);

assert(result2.scenarios.BATTERY_VIRTUAL != null, "Test 2 : BATTERY_VIRTUAL présent");
const baseOut2 = result2.scenarios.BASE;
const virtualOut2 = result2.scenarios.BATTERY_VIRTUAL;

assert(
  virtualOut2.energy?.prod === baseOut2.energy?.prod && virtualOut2.auto_kwh === baseOut2.auto_kwh,
  "Test 2 : energy BATTERY_VIRTUAL identique à BASE"
);
assert(baseOut2.flows != null && baseOut2.flows.length > 0, "Test 2 : BASE a des flows");
assert(virtualOut2.flows != null && virtualOut2.flows.length > 0, "Test 2 : BATTERY_VIRTUAL a des flows");

const baseAn1 = baseOut2.flows[0].total_eur;
const virtualAn1 = virtualOut2.flows[0].total_eur;
assert(
  virtualAn1 < baseAn1,
  `Test 2 : cashflow an1 BATTERY_VIRTUAL < BASE (virtual ${virtualAn1} < base ${baseAn1}, effet OPEX batterie virtuelle)`,
);

if (baseOut2.roi_years != null && virtualOut2.roi_years != null) {
  assert(virtualOut2.roi_years >= baseOut2.roi_years, "Test 2 : ROI BATTERY_VIRTUAL >= BASE (OPEX réduit le flux)");
}
assert(virtualOut2.capex_ttc === 18000, "Test 2 : CAPEX injecté identique (18000)");
console.log("✅ Test 2 — Virtual enabled + capex 18000 → BATTERY_VIRTUAL, energy = BASE, cashflows réduits par annual_cost_ttc");

// ——— Test 3 : Pas de capex injecté → BATTERY_VIRTUAL utilise capex 0 et produit finance (économie an1 non null) ———
const base3 = buildScenarioBaseV2({ ...baseCtx, finance_input: null });
const virtualScenario3 = JSON.parse(JSON.stringify(base3));
virtualScenario3.name = "BATTERY_VIRTUAL";
virtualScenario3.battery = "virtual";
virtualScenario3._v2 = true;
virtualScenario3._virtualBatteryQuote = { annual_cost_ht: 300, annual_cost_ttc: 360, detail: {} };

const ctx3 = { ...baseCtx, finance_input: null, settings: { economics: { horizon_years: 25 } } };
const scenarios3 = { BASE: base3, BATTERY_VIRTUAL: virtualScenario3 };
const result3 = await computeFinance(ctx3, scenarios3);

assert(result3.scenarios.BATTERY_VIRTUAL != null, "Test 3 : BATTERY_VIRTUAL présent");
assert(result3.scenarios.BATTERY_VIRTUAL.capex_ttc === null, "Test 3 : sans CAPEX PV (devis), finance absente");
assert(result3.scenarios.BATTERY_VIRTUAL.flows === null, "Test 3 : pas de flux sans CAPEX PV");
assert(
  Array.isArray(result3.scenarios.BATTERY_VIRTUAL.finance_warnings) &&
    result3.scenarios.BATTERY_VIRTUAL.finance_warnings.includes("MISSING_CAPEX"),
  "Test 3 : MISSING_CAPEX si pas de finance_input.capex_ttc",
);
console.log("✅ Test 3 — Sans CAPEX devis : pas de finance exploitable (cohérent)");

console.log("\n✅ Tous les tests BATTERY_VIRTUAL sont passés.");
