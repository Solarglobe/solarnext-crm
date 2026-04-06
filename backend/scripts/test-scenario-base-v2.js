/**
 * Test minimal du Scenario Builder V2 — scénario BASE sans pricing.
 * Usage: node backend/scripts/test-scenario-base-v2.js
 */

import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";

function makeHourly(size, valueFn) {
  return Array.from({ length: size }, (_, i) => (typeof valueFn === "function" ? valueFn(i) : valueFn));
}

const ctx = {
  pv: {
    hourly: makeHourly(8760, (i) => (i >= 2000 && i < 3000 ? 2.5 : 0)),
    kwc: 6,
    panelsCount: 12,
  },
  conso: {
    hourly: makeHourly(8760, 0.3),
    clamped: null,
  },
  conso_p_pilotee: makeHourly(8760, 0.3),
  form: { maison: { panneaux_max: 12 } },
  settings: { pricing: { kit_panel_power_w: 500 } },
};

const scenario = buildScenarioBaseV2(ctx);

// Assertions
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

assert(scenario.capex === null, "capex doit être null");
assert(scenario.capex_ttc === null, "capex_ttc doit être null");
assert(scenario.energy != null, "energy doit exister");
assert(Number.isFinite(scenario.energy.prod), "energy.prod doit être un nombre");
assert(scenario.energy.prod >= 0, "energy.prod >= 0");
assert(Number.isFinite(scenario.energy.auto) && Number.isFinite(scenario.energy.surplus), "auto et surplus définis");

const prodSum = scenario.energy.auto + scenario.energy.surplus;
const prodTolerance = Math.abs(scenario.energy.prod - prodSum) <= 1;
assert(prodTolerance, `energy.auto + energy.surplus === energy.prod (tolérance 1) — got prod=${scenario.energy.prod} sum=${prodSum}`);

assert(scenario.finance != null, "finance doit exister");
assert(scenario.finance.roi_years === null, "finance.roi_years doit être null");
assert(scenario.finance.irr === null, "finance.irr doit être null");
assert(scenario.finance.lcoe === null, "finance.lcoe doit être null");
assert(scenario.finance.cashflows === null, "finance.cashflows doit être null");

assert(scenario.metadata != null, "metadata doit exister");
assert(Number.isFinite(scenario.metadata.kwc), "metadata.kwc doit être un nombre");
assert(scenario.metadata.nb_panneaux === 12 || scenario.metadata.nb_panneaux != null, "metadata.nb_panneaux doit exister");

assert(scenario.prod_kwh === scenario.energy.prod, "prod_kwh === energy.prod");
assert(scenario.auto_kwh === scenario.energy.auto, "auto_kwh === energy.auto");
assert(scenario.surplus_kwh === scenario.energy.surplus, "surplus_kwh === energy.surplus");
assert(scenario.roi_years === null, "roi_years doit être null");
assert(scenario.name === "BASE", "name === BASE");
assert(scenario._v2 === true, "_v2 === true");

console.log("✅ test-scenario-base-v2.js — tous les asserts passent.");
console.log("   energy.prod:", scenario.energy.prod, "| auto:", scenario.energy.auto, "| surplus:", scenario.energy.surplus);
console.log("   metadata:", scenario.metadata);
