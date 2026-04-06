/**
 * CP-FAR-005 — Tests cohérence mensuelle Horizon & Shading
 * SOUTH_10: hiver plus impacté que été
 * EAST_20: répartition plausible
 * Usage: cd backend && npm run test-shading-far-monthly
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

const LAT = 48.8566;

(async () => {
const LON = 2.3522;

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

function buildMaskEast20() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    mask.push({ az, elev: az >= 45 && az <= 135 ? 20 : 0 });
  }
  return { mask };
}

function buildMaskSouth10() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    mask.push({ az, elev: az >= 135 && az <= 225 ? 10 : 0 });
  }
  return { mask };
}

function farLossPctPerMonth(monthlyBaseline, monthlyFar) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const base = monthlyBaseline[m] || 0;
    const far = monthlyFar[m] || 0;
    out.push(base > 0 ? 100 * (1 - far / base) : 0);
  }
  return out;
}

function avgOverMonths(arr, months) {
  let sum = 0;
  let n = 0;
  for (const m of months) {
    if (typeof arr[m] === "number") {
      sum += arr[m];
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

let passed = 0;
let failed = 0;

function ok(label) {
  console.log("✅ " + label);
  passed++;
}

function fail(label, msg) {
  console.log("❌ " + label + ": " + msg);
  failed++;
}

function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

// --- Test 4a: SOUTH_10 — hiver > été ---
console.log("\n--- Test 4a: SOUTH_10 — hiver plus impacté que été ---");
const rSouth = await computeCalpinageShading({
  lat: LAT,
  lon: LON,
  panels: [panel],
  obstacles: [],
  options: {
    __testHorizonMaskOverride: buildMaskSouth10(),
    __testReturnMonthly: true,
  },
});

assert(rSouth?.__testMonthly != null, "__testMonthly présent");
const { monthlyBaselineEnergy, monthlyFarEnergy } = rSouth.__testMonthly;
const farLossSouth = farLossPctPerMonth(monthlyBaselineEnergy, monthlyFarEnergy);

const winterMonths = [0, 1, 10, 11];
const summerMonths = [4, 5, 6, 7];
const avgWinter = avgOverMonths(farLossSouth, winterMonths);
const avgSummer = avgOverMonths(farLossSouth, summerMonths);

assert(avgWinter > avgSummer, "SOUTH_10: farLossPct(hiver) > farLossPct(été)");

// --- Test 4b: EAST_20 — répartition plausible ---
console.log("\n--- Test 4b: EAST_20 — répartition plausible ---");
const rEast = await computeCalpinageShading({
  lat: LAT,
  lon: LON,
  panels: [panel],
  obstacles: [],
  options: {
    __testHorizonMaskOverride: buildMaskEast20(),
    __testReturnMonthly: true,
  },
});

assert(rEast?.__testMonthly != null, "__testMonthly présent");
const farLossEast = farLossPctPerMonth(
  rEast.__testMonthly.monthlyBaselineEnergy,
  rEast.__testMonthly.monthlyFarEnergy
);

const maxEast = Math.max(...farLossEast);
assert(rEast.farLossPct > 0.5, "EAST_20: farLossPct > 0.5");
assert(maxEast <= 100, "EAST_20: max mensuel <= 100");
assert(rEast.farLossPct <= 50, "EAST_20: farLossPct annuel <= 50 (sanity)");

// --- Résumé ---
console.log("\n--- RÉSUMÉ ---");
console.log("Passed: " + passed + ", Failed: " + failed);

if (failed > 0) {
  console.log("\n❌ FAIL");
  process.exit(1);
}
console.log("\n✅ PASS");
process.exit(0);
})();
