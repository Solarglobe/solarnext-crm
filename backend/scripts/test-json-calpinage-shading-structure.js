/**
 * CP-FAR-004 — Tests structure JSON shading { near, far, combined }
 * Usage: cd backend && npm run test-json-calpinage-shading-structure
 */

import { buildStructuredShading } from "../services/shading/shadingStructureBuilder.js";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";

let passed = 0;

(async () => {
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

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

function buildMaskConstant(elevDeg) {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    mask.push({ az: i * 2, elev: elevDeg });
  }
  return { mask };
}

// --- 1) Cas far actif ---
console.log("\n--- 1) Cas far actif ---");
const resultFarActive = await computeCalpinageShading({
  lat: 48.8566,
  lon: 2.3522,
  panels: [panel],
  obstacles: [],
  options: { __testHorizonMaskOverride: buildMaskConstant(15) },
});
const shadingFarActive = buildStructuredShading(resultFarActive, true, true, {});

assert(shadingFarActive != null, "shadingFarActive non null");
assert(
  typeof shadingFarActive.near?.totalLossPct === "number",
  "shading.near.totalLossPct existe"
);
assert(
  shadingFarActive.far?.source === "RELIEF_ONLY",
  "shading.far.source === RELIEF_ONLY"
);
assert(
  shadingFarActive.far?.totalLossPct > 0,
  "shading.far.totalLossPct > 0"
);
assert(
  shadingFarActive.combined?.totalLossPct === shadingFarActive.totalLossPct,
  "shading.combined.totalLossPct === totalLossPct global"
);
assert(
  shadingFarActive.farLossPct === shadingFarActive.far?.totalLossPct,
  "farLossPct (legacy) === far.totalLossPct"
);
assert(
  shadingFarActive.nearLossPct === shadingFarActive.near?.totalLossPct,
  "nearLossPct (legacy) === near.totalLossPct"
);
assert(
  shadingFarActive.far?.dataCoverage != null,
  "shading.far.dataCoverage présent (CP-FAR-007)"
);
assert(
  typeof shadingFarActive.far?.confidenceScore === "number",
  "shading.far.confidenceScore présent (CP-FAR-010)"
);
assert(
  ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].includes(shadingFarActive.far?.confidenceLevel),
  "shading.far.confidenceLevel valide (CP-FAR-010)"
);
assert(
  shadingFarActive.far?.source === "RELIEF_ONLY" ? shadingFarActive.far?.confidenceScore <= 30 : true,
  "RELIEF_ONLY plafonné à 30 (CP-FAR-010)"
);
assert(
  shadingFarActive.shadingQuality != null && typeof shadingFarActive.shadingQuality.score === "number",
  "shadingQuality présent (CP-FAR-011)"
);

// --- 2) Cas far désactivé (GPS absent) ---
console.log("\n--- 2) Cas far désactivé (GPS absent) ---");
const resultNoGps = await computeCalpinageShading({
  panels: [panel],
  obstacles: [],
  storedNearLossPct: 5,
});
const shadingNoGps = buildStructuredShading(resultNoGps, false, true, {});

assert(shadingNoGps.far?.totalLossPct == null, "shading.far.totalLossPct === null (GPS absent)");
assert(shadingNoGps.far?.source === "UNAVAILABLE_NO_GPS", "shading.far.source === UNAVAILABLE_NO_GPS");
assert(shadingNoGps.far?.radius_m === null, "shading.far.radius_m === null");
assert(shadingNoGps.far?.confidence === null, "shading.far.confidence === null");
assert(
  shadingNoGps.combined?.totalLossPct === shadingNoGps.near?.totalLossPct,
  "shading.combined.totalLossPct === shading.near.totalLossPct"
);
assert(shadingNoGps.farLossPct === null, "farLossPct legacy null sans GPS");
assert(shadingNoGps.shadingQuality?.blockingReason === "missing_gps", "shadingQuality.blockingReason missing_gps");

// --- 3) Champs legacy conservés ---
console.log("\n--- 3) Champs legacy conservés ---");
assert(
  typeof shadingFarActive.farLossPct === "number",
  "farLossPct (legacy) présent"
);
assert(
  typeof shadingFarActive.nearLossPct === "number",
  "nearLossPct (legacy) présent"
);
assert(
  typeof shadingFarActive.totalLossPct === "number",
  "totalLossPct (legacy) présent"
);

// --- 4) Merge avec existingShading ---
console.log("\n--- 4) Merge avec existingShading ---");
const existing = {
  customField: "preserved",
  near: { someLegacyField: 42 },
};
const merged = buildStructuredShading(resultFarActive, true, true, existing);
assert(merged.customField === "preserved", "champ custom conservé");
assert(merged.near?.someLegacyField === 42, "near.someLegacyField conservé");
assert(merged.near?.totalLossPct === resultFarActive.nearLossPct, "near.totalLossPct mis à jour");

// --- 5) Far actif avec horizon 90° ---
console.log("\n--- 5) Far actif horizon 90° ---");
const result90 = await computeCalpinageShading({
  lat: 48.8566,
  lon: 2.3522,
  panels: [panel],
  obstacles: [],
  options: { __testHorizonMaskOverride: buildMaskConstant(90) },
});
const shading90 = buildStructuredShading(result90, true, true, {});
assert(shading90.far?.source === "RELIEF_ONLY", "far.source RELIEF_ONLY");
assert(shading90.far?.totalLossPct >= 99, "far.totalLossPct ~ 100");
assert(shading90.combined?.totalLossPct >= 99, "combined.totalLossPct ~ 100");

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
