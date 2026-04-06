/**
 * CP-FAR-005 — Tests synthétiques Horizon & Shading
 * Masques MASK_FLAT_0, MASK_EAST_20, MASK_SOUTH_10
 * Usage: cd backend && npm run test-shading-far-synthetic
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

function buildMaskFlat0() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    mask.push({ az: i * 2, elev: 0 });
  }
  return { mask };
}

function buildMaskEast20() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 45 && az <= 135 ? 20 : 0;
    mask.push({ az, elev });
  }
  return { mask };
}

function buildMaskSouth10() {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    const az = i * 2;
    const elev = az >= 135 && az <= 225 ? 10 : 0;
    mask.push({ az, elev });
  }
  return { mask };
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

const runOpts = {
  lat: LAT,
  lon: LON,
  panels: [panel],
  obstacles: [],
};

// --- Test 1: MASK_FLAT_0 => farLossPct ≈ 0 ---
console.log("\n--- Test 1: MASK_FLAT_0 => farLossPct ≈ 0 ---");
const r1 = await computeCalpinageShading({
  ...runOpts,
  options: { __testHorizonMaskOverride: buildMaskFlat0() },
});
assert(r1 != null, "result non null");
assert(r1.farLossPct <= 0.5, "farLossPct <= 0.5 (tolérance)");
assert(
  Math.abs(r1.totalLossPct - r1.nearLossPct) <= 0.5,
  "totalLossPct ≈ nearLossPct (diff <= 0.5)"
);

// --- Test 2: MASK_EAST_20 => pertes matin, non nul ---
console.log("\n--- Test 2: MASK_EAST_20 => pertes matin, non nul ---");
const r2 = await computeCalpinageShading({
  ...runOpts,
  options: { __testHorizonMaskOverride: buildMaskEast20() },
});
assert(r2 != null, "result non null");
assert(r2.farLossPct > 0.5, "farLossPct > 0.5 (non nul)");
assert(r2.totalLossPct >= r2.farLossPct, "totalLossPct >= farLossPct");
assert(r2.farLossPct <= 50, "farLossPct <= 50 (sanity)");

// --- Test 3: MASK_SOUTH_10 => pertes hiver ---
console.log("\n--- Test 3: MASK_SOUTH_10 => pertes hiver ---");
const r3 = await computeCalpinageShading({
  ...runOpts,
  options: { __testHorizonMaskOverride: buildMaskSouth10() },
});
assert(r3 != null, "result non null");
assert(r3.farLossPct > 0.5, "farLossPct > 0.5 (non nul)");
assert(r3.totalLossPct >= r3.farLossPct, "totalLossPct >= farLossPct");
assert(r3.farLossPct <= 50, "farLossPct <= 50 (sanity)");

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
