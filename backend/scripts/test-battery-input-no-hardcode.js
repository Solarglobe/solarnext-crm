/**
 * Test batterie : plus de 7 kWh hardcodé, refus propre si capacity null.
 * Usage: node backend/scripts/test-battery-input-no-hardcode.js
 */

import { simulateBattery8760 } from "../services/batteryService.js";

const HOURS = 8760;
const pvHourly = Array.from({ length: HOURS }, (_, i) => (i >= 1000 && i < 2000 ? 3 : 0.5));
const consoHourly = Array.from({ length: HOURS }, () => 0.8);

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ——— Test 1 : enabled true mais capacity null → refus propre (ok: false) ———
const out1 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: consoHourly,
  battery: { enabled: true, capacity_kwh: null },
});

assert(out1.ok === false, "Test 1 : ok doit être false");
assert(out1.reason === "MISSING_BATTERY_CAPACITY", "Test 1 : reason = MISSING_BATTERY_CAPACITY");
assert(!out1.auto_hourly || out1.auto_hourly.length !== HOURS, "Test 1 : pas de simulation (pas de hourly inventé)");
console.log("✅ Test 1 — enabled true, capacity null → ok: false, reason: MISSING_BATTERY_CAPACITY");

// ——— Test 2 : capacity fournie → simulation OK, prod = auto + surplus (tolérance) ———
const out2 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: consoHourly,
  battery: {
    enabled: true,
    capacity_kwh: 10,
    roundtrip_efficiency: 0.9,
    max_charge_kw: 5,
    max_discharge_kw: 5,
  },
});

assert(out2.ok === true, "Test 2 : ok doit être true");
assert(Array.isArray(out2.auto_hourly) && out2.auto_hourly.length === HOURS, "Test 2 : auto_hourly 8760");
assert(Array.isArray(out2.surplus_hourly) && out2.surplus_hourly.length === HOURS, "Test 2 : surplus_hourly 8760");
const prod = out2.prod_kwh;
const auto = out2.auto_kwh;
const surplus = out2.surplus_kwh;
const losses = out2.battery_losses_kwh ?? 0;
assert(Number.isFinite(prod) && prod >= 0, "Test 2 : prod_kwh >= 0");
const sumAutoSurplusLosses = auto + surplus + losses;
assert(Math.abs(prod - sumAutoSurplusLosses) <= 5, `Test 2 : prod ≈ auto + surplus + battery_losses (tolérance 5) — prod=${prod} auto+surplus+losses=${sumAutoSurplusLosses}`);
console.log("✅ Test 2 — capacity 10 kWh, roundtrip 0.9 → prod:", prod, "| auto:", auto, "| surplus:", surplus, "| battery_losses:", losses);

// ——— Test 3 : battery absent → NO_BATTERY, pass-through sans crash ———
const out3 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: consoHourly,
  battery: null,
});
assert(out3.ok === false && out3.reason === "NO_BATTERY", "Test 3 : NO_BATTERY");
assert(Array.isArray(out3.auto_hourly) && out3.auto_hourly.length === HOURS, "Test 3 : pass-through fournit auto_hourly");
console.log("✅ Test 3 — battery null → NO_BATTERY, pass-through OK");

// ——— Test 4 : enabled false → NO_BATTERY ———
const out4 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: consoHourly,
  battery: { enabled: false, capacity_kwh: 10 },
});
assert(out4.ok === false && out4.reason === "NO_BATTERY", "Test 4 : enabled false → NO_BATTERY");
console.log("✅ Test 4 — enabled false → NO_BATTERY");

console.log("\n✅ test-battery-input-no-hardcode.js — tous les tests passent.");
