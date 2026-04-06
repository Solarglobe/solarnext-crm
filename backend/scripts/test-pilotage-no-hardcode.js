/**
 * Test pilotage : plus de 7 kWh hardcodé, capacité uniquement depuis battery (devis).
 * Utilise batteryService.simulateBattery8760 (moteur V2).
 * Usage: node backend/scripts/test-pilotage-no-hardcode.js
 */

import { simulateBattery8760 } from "../services/batteryService.js";

const HOURS = 8760;
const pvHourly = Array.from({ length: HOURS }, (_, i) => (i >= 500 && i < 1500 ? 2 : 0.3));
const loadHourly = Array.from({ length: HOURS }, () => 0.5);

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ——— Test 1 : battery = null → pass-through sans batterie ———
const out1 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: loadHourly,
  battery: null,
});
assert(out1 != null, "Test 1 : résultat non null");
assert(out1.ok === false && out1.reason === "NO_BATTERY", "Test 1 : ok false, reason NO_BATTERY");
assert(Number.isFinite(out1.auto_kwh) && out1.auto_kwh >= 0, "Test 1 : auto_kwh défini");
console.log("✅ Test 1 — battery null → pass-through sans batterie");

// ——— Test 2 : battery = { enabled: true, capacity_kwh: 10 } → utilise 10 ———
const out2 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: loadHourly,
  battery: { enabled: true, capacity_kwh: 10 },
});
assert(out2 != null, "Test 2 : résultat non null");
assert(out2.ok === true, "Test 2 : ok true");
assert(Number.isFinite(out2.auto_kwh), "Test 2 : auto_kwh défini");
assert(Array.isArray(out2.batt_charge_hourly) && out2.batt_charge_hourly.length === HOURS, "Test 2 : batt_charge 8760");
console.log("✅ Test 2 — capacity_kwh 10 → pilotage avec batterie (ok=true)");

// ——— Test 3 : battery = { enabled: true, capacity_kwh: null } → refuse batterie ———
const out3 = simulateBattery8760({
  pv_hourly: pvHourly,
  conso_hourly: loadHourly,
  battery: { enabled: true, capacity_kwh: null },
});
assert(out3 != null, "Test 3 : résultat non null");
assert(out3.ok === false, "Test 3 : capacity null → ok false");
assert(out3.reason === "MISSING_BATTERY_CAPACITY", "Test 3 : reason MISSING_BATTERY_CAPACITY");
console.log("✅ Test 3 — enabled true, capacity_kwh null → refus (pas de 7 kWh hardcodé)");

console.log("\n✅ test-pilotage-no-hardcode.js — tous les tests passent.");
