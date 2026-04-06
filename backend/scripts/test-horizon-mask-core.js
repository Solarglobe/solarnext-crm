/**
 * CP-FAR-001 — Tests Horizon Mask Core (relief only)
 * Usage: cd backend && node scripts/test-horizon-mask-core.js
 */

import {
  computeHorizonMaskReliefOnly,
  validateHorizonMaskParams,
  interpolateHorizonElevation,
} from "../services/horizon/horizonMaskCore.js";

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`✅ ${label}`);
  passed++;
}

function fail(label, msg) {
  console.log(`❌ ${label}: ${msg}`);
  failed++;
}

function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

// --- 1) Test computeHorizonMaskReliefOnly ---
console.log("\n--- 1) computeHorizonMaskReliefOnly ---");
const result = computeHorizonMaskReliefOnly({
  lat: 48.8566,
  lon: 2.3522,
  radius_m: 500,
  step_deg: 2,
});

assert(result.source === "RELIEF_ONLY", "source === RELIEF_ONLY");
assert(result.resolution_m === 25, "resolution_m === 25");
assert(result.mask.length === 180, "mask.length === 180 (360/2)");
assert(result.mask[0].az === 0, "mask[0].az === 0");

let azOk = true;
for (let i = 0; i < result.mask.length; i++) {
  if (result.mask[i].az !== i * 2) {
    azOk = false;
    break;
  }
}
assert(azOk, "mask[i].az === i*2");

let elevOk = true;
for (const m of result.mask) {
  if (m.elev < 0 || m.elev > 90) {
    elevOk = false;
    break;
  }
}
assert(elevOk, "elev in [0..90]");

assert(
  result.confidence >= 0 && result.confidence <= 1,
  "confidence in [0,1]"
);

// --- 2) Test déterminisme ---
console.log("\n--- 2) Déterminisme ---");
const r1 = computeHorizonMaskReliefOnly({
  lat: 48.8566,
  lon: 2.3522,
  radius_m: 500,
  step_deg: 2,
});
const r2 = computeHorizonMaskReliefOnly({
  lat: 48.8566,
  lon: 2.3522,
  radius_m: 500,
  step_deg: 2,
});
assert(
  JSON.stringify(r1) === JSON.stringify(r2),
  "run twice → JSON.stringify égal"
);

// --- 3) Test interpolation ---
console.log("\n--- 3) Interpolation ---");
const mask = result.mask;
const eps = 1e-6;

const interp0 = interpolateHorizonElevation(mask, 0);
assert(
  Math.abs(interp0 - mask[0].elev) < eps,
  "interpolate(mask, 0) ≈ mask[0].elev"
);

const interp1 = interpolateHorizonElevation(mask, 1);
const e0 = mask[0].elev;
const e2 = mask[1].elev;
const between = interp1 >= Math.min(e0, e2) && interp1 <= Math.max(e0, e2);
assert(between, "interpolate(mask, 1) entre mask[0] et mask[2]");

const interp359 = interpolateHorizonElevation(mask, 359);
const e358 = mask[179].elev;
const e0wrap = mask[0].elev;
const between359 =
  interp359 >= Math.min(e358, e0wrap) && interp359 <= Math.max(e358, e0wrap);
assert(between359, "interpolate(mask, 359) entre mask[358] et mask[0] (wrap)");

// --- 4) Tests validation params ---
console.log("\n--- 4) Validation params ---");

try {
  validateHorizonMaskParams({ lat: 48, lon: 2, radius_m: 500, step_deg: 0 });
  fail("step_deg=0 → throw", "devrait throw");
} catch (e) {
  assert(e.message.includes("step_deg"), "step_deg=0 → throw avec message clair");
}

try {
  validateHorizonMaskParams({ lat: 999, lon: 2, radius_m: 500, step_deg: 2 });
  fail("lat=999 → throw", "devrait throw");
} catch (e) {
  assert(e.message.includes("lat"), "lat=999 → throw avec message clair");
}

try {
  computeHorizonMaskReliefOnly({ lat: 48, lon: 2, radius_m: 500, step_deg: 0 });
  fail("compute avec step_deg=0 → throw", "devrait throw");
} catch (e) {
  ok("compute avec step_deg=0 → throw");
}

try {
  computeHorizonMaskReliefOnly({ lat: 999, lon: 2, radius_m: 500, step_deg: 2 });
  fail("compute avec lat=999 → throw", "devrait throw");
} catch (e) {
  ok("compute avec lat=999 → throw");
}

// --- Résumé ---
console.log("\n--- RÉSUMÉ ---");
console.log(`Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  console.log("\n❌ FAIL");
  process.exit(1);
}
console.log("\n✅ PASS");
process.exit(0);
