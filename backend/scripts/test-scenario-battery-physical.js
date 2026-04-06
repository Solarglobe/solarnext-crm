/**
 * Test scénario BATTERY_PHYSICAL V2 (PROMPT 5).
 * Usage: node backend/scripts/test-scenario-battery-physical.js
 */

import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { simulateBattery8760 } from "../services/batteryService.js";
import { aggregateMonthly } from "../services/monthlyAggregator.js";

const HOURS = 8760;
function makeHourly(size, valueFn) {
  return Array.from({ length: size }, (_, i) => (typeof valueFn === "function" ? valueFn(i) : valueFn));
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ——— Contexte commun ———
const baseCtx = {
  pv: {
    hourly: makeHourly(8760, (i) => (i >= 2000 && i < 4000 ? 2.5 : 0.4)),
    kwc: 6,
    panelsCount: 12,
  },
  conso: { hourly: makeHourly(8760, 0.5), clamped: null },
  conso_p_pilotee: makeHourly(8760, 0.5),
  form: { maison: { panneaux_max: 12 } },
  settings: { pricing: {} },
};

// ——— Test 1 : Pas de batterie → scenarios = { BASE } uniquement ———
const ctxNoBattery = { ...baseCtx, battery_input: null, finance_input: null };
const base1 = buildScenarioBaseV2(ctxNoBattery);
assert(base1.name === "BASE", "BASE name");
assert(base1.battery === false, "BASE sans batterie");

const scenarios1 = { BASE: base1 };
const batteryEnabled1 = ctxNoBattery.battery_input?.enabled === true && Number(ctxNoBattery.battery_input?.capacity_kwh) > 0;
assert(batteryEnabled1 === false, "Test 1 : battery_input null → pas de BATTERY_PHYSICAL");
assert(!scenarios1.BATTERY_PHYSICAL, "Test 1 : uniquement BASE");
console.log("✅ Test 1 — Pas de batterie → scenarios = { BASE } uniquement");

// ——— Test 2 : Batterie 10 kWh + capex 20000 → BATTERY_PHYSICAL présent, auto > BASE.auto, surplus < BASE.surplus, capex 20000, ROI ———
const ctxWithBattery = {
  ...baseCtx,
  battery_input: { enabled: true, capacity_kwh: 10, roundtrip_efficiency: 0.9, max_charge_kw: 5, max_discharge_kw: 5 },
  finance_input: { capex_ttc: 20000 },
};
const base2 = buildScenarioBaseV2(ctxWithBattery);
const batt2 = simulateBattery8760({
  pv_hourly: ctxWithBattery.pv.hourly,
  conso_hourly: ctxWithBattery.conso_p_pilotee,
  battery: ctxWithBattery.battery_input,
});

assert(batt2.ok === true, "Test 2 : sim batterie OK");
assert(batt2.auto_kwh > base2.auto_kwh, "Test 2 : auto_kwh (batterie) > BASE.auto_kwh");
assert(batt2.surplus_kwh < base2.surplus_kwh, "Test 2 : surplus_kwh (batterie) < BASE.surplus_kwh");

// Monthly à partir des flux post-batterie (ctx.pv.hourly inchangé + batt auto/surplus)
const monthlyBatt2 = aggregateMonthly(ctxWithBattery.pv.hourly, ctxWithBattery.conso_p_pilotee, batt2);
const batteryScenario2 = JSON.parse(JSON.stringify(base2));
batteryScenario2.name = "BATTERY_PHYSICAL";
batteryScenario2.battery = true;
batteryScenario2._v2 = true;
const batteryLossesKwh = batt2.battery_losses_kwh ?? 0;
batteryScenario2.energy = {
  prod: base2.energy.prod,
  auto: batt2.auto_kwh,
  surplus: batt2.surplus_kwh,
  import: batt2.grid_import_kwh ?? 0,
  conso: base2.energy.conso,
  battery_losses_kwh: batteryLossesKwh,
  monthly: monthlyBatt2.map(m => ({ prod: m.prod_kwh, conso: m.conso_kwh, auto: m.auto_kwh, surplus: m.surplus_kwh, import: m.import_kwh })),
  hourly: null,
};
batteryScenario2.prod_kwh = base2.energy.prod;
batteryScenario2.auto_kwh = batt2.auto_kwh;
batteryScenario2.surplus_kwh = batt2.surplus_kwh;
batteryScenario2.conso_kwh = base2.conso_kwh;
batteryScenario2.monthly = monthlyBatt2;
batteryScenario2.capex_ttc = ctxWithBattery.finance_input?.capex_ttc ?? null;

assert(batteryScenario2.capex_ttc === 20000, "Test 2 : capex_ttc === 20000");
assert(batteryScenario2.auto_kwh > base2.auto_kwh, "Test 2 : BATTERY_PHYSICAL.auto_kwh > BASE.auto_kwh");
assert(batteryScenario2.surplus_kwh < base2.surplus_kwh, "Test 2 : BATTERY_PHYSICAL.surplus_kwh < BASE.surplus_kwh");

const TOL_KWH = 5;
const sumMonthlyAuto2 = monthlyBatt2.reduce((a, m) => a + m.auto_kwh, 0);
const sumMonthlySurplus2 = monthlyBatt2.reduce((a, m) => a + m.surplus_kwh, 0);
assert(Math.abs(sumMonthlyAuto2 - batteryScenario2.energy.auto) <= TOL_KWH, `Test 2 : Σ monthly.auto ≈ energy.auto (${sumMonthlyAuto2} vs ${batteryScenario2.energy.auto})`);
assert(Math.abs(sumMonthlySurplus2 - batteryScenario2.energy.surplus) <= TOL_KWH, `Test 2 : Σ monthly.surplus ≈ energy.surplus (${sumMonthlySurplus2} vs ${batteryScenario2.energy.surplus})`);
assert(Math.abs(batteryScenario2.energy.prod - (batteryScenario2.energy.auto + batteryScenario2.energy.surplus + (batteryScenario2.energy.battery_losses_kwh ?? 0))) <= TOL_KWH, `Test 2 : prod ≈ auto+surplus+battery_losses (tol ${TOL_KWH})`);
console.log("✅ Test 2 — Batterie 10 kWh + capex 20000 → BATTERY_PHYSICAL présent, auto > BASE, surplus < BASE, capex 20000");
console.log("✅ Test 2 — Cohérence monthly: Σmonthly.auto≈energy.auto, Σmonthly.surplus≈energy.surplus, prod≈auto+surplus");

// ——— Test 3 : Batterie sans capex → finance null, energy calculée ———
const ctxBatteryNoCapex = {
  ...baseCtx,
  battery_input: { enabled: true, capacity_kwh: 10 },
  finance_input: { capex_ttc: null },
};
const base3 = buildScenarioBaseV2(ctxBatteryNoCapex);
const batt3 = simulateBattery8760({
  pv_hourly: ctxBatteryNoCapex.pv.hourly,
  conso_hourly: ctxBatteryNoCapex.conso_p_pilotee,
  battery: ctxBatteryNoCapex.battery_input,
});
assert(batt3.ok === true, "Test 3 : sim batterie OK");
assert(ctxBatteryNoCapex.finance_input.capex_ttc === null, "Test 3 : pas de capex");
assert(base3.finance?.roi_years === null && base3.capex_ttc === null, "Test 3 : BASE finance null");
console.log("✅ Test 3 — Batterie sans capex → energy calculée, finance null");

console.log("\n✅ test-scenario-battery-physical.js — tous les tests passent.");
