/**
 * Tests deriveHourly8760 — agrégation 15m / 30m / 1h vers 8760.
 * Test 1: 35040 points (15m) → hourly.length = 8760
 * Test 2: 17520 points (30m) → 8760
 * Test 3: 8760 points (hourly) → inchangé
 *
 * Usage: node backend/services/energy/__tests__/deriveHourly8760.test.js
 */

import { deriveHourly8760 } from "../energyProfileStorage.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  console.log("=== deriveHourly8760 tests ===\n");

  // Test 1 — profil 15m (35040 points) → 8760
  {
    const data = [];
    for (let i = 0; i < 35040; i++) {
      data.push({
        timestamp: new Date(2024, 0, 1, 0, 0, 0).getTime() + i * 15 * 60 * 1000,
        consumption_kwh: 0.25,
      });
    }
    const profile = { data };
    const hourly = deriveHourly8760(profile);
    assert(Array.isArray(hourly), "T1: result is array");
    assert(hourly.length === 8760, "T1: hourly.length === 8760");
    assert(hourly.every((v) => v === 1), "T1: each hour = 4*0.25 = 1");
    console.log("✅ T1: 15m (35040 points) → 8760, sum per hour = 1");
  }

  // Test 2 — profil 30m (17520 points) → 8760
  {
    const data = [];
    for (let i = 0; i < 17520; i++) {
      data.push({
        timestamp: `2024-01-01T${String(Math.floor(i / 2) % 24).padStart(2, "0")}:${String((i % 2) * 30).padStart(2, "0")}:00+01:00`,
        consumption_kwh: 0.5,
      });
    }
    const profile = { data };
    const hourly = deriveHourly8760(profile);
    assert(Array.isArray(hourly), "T2: result is array");
    assert(hourly.length === 8760, "T2: hourly.length === 8760");
    assert(hourly.every((v) => v === 1), "T2: each hour = 0.5+0.5 = 1");
    console.log("✅ T2: 30m (17520 points) → 8760, sum per hour = 1");
  }

  // Test 3 — profil hourly (8760) → inchangé
  {
    const hourlyInput = Array.from({ length: 8760 }, (_, i) => (i % 24) + 0.5);
    const profile = { hourly: hourlyInput };
    const hourly = deriveHourly8760(profile);
    assert(Array.isArray(hourly), "T3: result is array");
    assert(hourly.length === 8760, "T3: hourly.length === 8760");
    assert(hourly[0] === 0.5 && hourly[23] === 23.5, "T3: values unchanged");
    console.log("✅ T3: hourly (8760) → inchangé");
  }

  console.log("\n--- Tous les tests deriveHourly8760 OK ---");
}

main();
