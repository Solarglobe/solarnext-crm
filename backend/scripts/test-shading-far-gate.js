/**
 * CP-FAR-003 — Tests Horizon Gate (backend shading service)
 * Usage: cd backend && npm run test-shading-far-gate
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

const lat = 48.8566;

(async () => {
const lon = 2.3522;

function buildMaskConstant(elevDeg) {
  const step = 2;
  const n = 180;
  const mask = [];
  for (let i = 0; i < n; i++) {
    mask.push({ az: i * step, elev: elevDeg });
  }
  return { mask };
}

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

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

// --- Cas A: horizon 0° partout => farLossPct ~ 0 ---
console.log("\n--- Cas A: horizon 0° => farLossPct ~ 0 ---");
const mask0 = buildMaskConstant(0);
const resultA = await computeCalpinageShading({
  lat,
  lon,
  panels: [panel],
  obstacles: [],
  options: { __testHorizonMaskOverride: mask0 },
});

assert(resultA != null, "resultA non null");
assert(resultA.farLossPct >= 0 && resultA.farLossPct <= 100, "farLossPct in [0,100]");
assert(resultA.nearLossPct >= 0 && resultA.nearLossPct <= 100, "nearLossPct in [0,100]");
assert(resultA.totalLossPct >= 0 && resultA.totalLossPct <= 100, "totalLossPct in [0,100]");
assert(resultA.totalLossPct >= resultA.farLossPct, "totalLossPct >= farLossPct");
assert(resultA.farLossPct < 1, "farLossPct ~ 0 (horizon 0°)");
assert(resultA.totalLossPct < 5, "totalLossPct ≈ 0 (horizon 0°, near neutral)");

// --- Cas B: horizon 90° partout => farLossPct ~ 100, totalLossPct ~ 100 ---
console.log("\n--- Cas B: horizon 90° => farLossPct ~ 100 ---");
const mask90 = buildMaskConstant(90);
const resultB = await computeCalpinageShading({
  lat,
  lon,
  panels: [panel],
  obstacles: [],
  options: { __testHorizonMaskOverride: mask90 },
});

assert(resultB != null, "resultB non null");
assert(resultB.farLossPct >= 99, "farLossPct ~ 100 (direct totalement bloqué)");
assert(resultB.totalLossPct >= 99, "totalLossPct ~ 100");
assert(resultB.nearLossPct === 0, "nearLossPct = 0 (energyFar = 0)");

// --- Near neutral => totalLossPct == farLossPct ---
console.log("\n--- Near neutral => totalLossPct ≈ farLossPct ---");
const resultC = await computeCalpinageShading({
  lat,
  lon,
  panels: [panel],
  obstacles: [],
});
assert(resultC != null, "resultC non null");
assert(Math.abs(resultC.totalLossPct - resultC.farLossPct) < 2, "near neutral: totalLossPct ≈ farLossPct");

// --- Invariants généraux ---
console.log("\n--- Invariants ---");
assert(resultC.farLossPct >= 0 && resultC.farLossPct <= 100, "farLossPct in [0,100]");
assert(resultC.nearLossPct >= 0 && resultC.nearLossPct <= 100, "nearLossPct in [0,100]");
assert(resultC.totalLossPct >= 0 && resultC.totalLossPct <= 100, "totalLossPct in [0,100]");
assert(resultC.totalLossPct >= resultC.farLossPct, "totalLossPct >= farLossPct");

// --- Pas de GPS => farLossPct = null, totalLossPct = nearLossPct, blocage explicite ---
console.log("\n--- Pas de GPS => farLossPct = null, totalLossPct = near stocké ---");
const resultNoGps = await computeCalpinageShading({
  panels: [panel],
  obstacles: [],
  storedNearLossPct: 5,
});
assert(resultNoGps.farLossPct === null, "farLossPct = null sans GPS");
assert(resultNoGps.totalLossPct === 5, "totalLossPct = storedNearLossPct");
assert(resultNoGps.blockingReason === "missing_gps", "blockingReason missing_gps");

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
