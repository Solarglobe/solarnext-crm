/**
 * CP-FAR-010 — Tests unitaires modèle de confiance Far Shading
 * Usage: node tests/far-confidence-model.test.js
 */

import { computeFarConfidence } from "../services/horizon/confidence/farConfidenceModel.js";

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

// --- 1) RELIEF_ONLY → score <= 55 ---
console.log("\n--- 1) RELIEF_ONLY → score <= 55 ---");
const r1 = computeFarConfidence({
  source: "RELIEF_ONLY",
  algorithm: "LEGACY",
  gridResolutionMeters: 5,
  dataCoverageRatio: 1,
  stepDeg: 0.5,
});
assert(r1.score <= 55, "RELIEF_ONLY plafonné à 55");
assert(r1.level === "LOW" || r1.level === "MEDIUM", "RELIEF_ONLY niveau LOW ou MEDIUM");
assert(r1.breakdown != null, "breakdown présent");

// --- 2) DSM 5m + HD + coverage 0.98 → score >= 90 ---
console.log("\n--- 2) DSM 5m + HD + coverage 0.98 → score >= 90 ---");
const r2 = computeFarConfidence({
  source: "SURFACE_DSM",
  algorithm: "RAYCAST_HD",
  gridResolutionMeters: 5,
  maxDistanceMeters: 4000,
  dataCoverageRatio: 0.98,
  stepDeg: 0.5,
  obstacleDistancesMeters: [80, 120, 90],
});
assert(r2.score >= 90, "DSM 5m + HD + 0.98 coverage → score >= 90");
assert(r2.level === "VERY_HIGH", "niveau VERY_HIGH");

// --- 3) DSM 30m + coverage 0.6 → score medium ---
console.log("\n--- 3) DSM 30m + coverage 0.6 → score medium ---");
const r3 = computeFarConfidence({
  source: "SURFACE_DSM",
  algorithm: "LEGACY",
  gridResolutionMeters: 30,
  dataCoverageRatio: 0.6,
  stepDeg: 2,
});
assert(r3.score >= 40 && r3.score <= 70, "DSM 30m + 0.6 coverage → score medium range");
assert(["LOW", "MEDIUM", "HIGH"].includes(r3.level), "niveau LOW, MEDIUM ou HIGH (selon seuils)");

// --- 4) stepDeg 0.5 > stepDeg 1 en score ---
console.log("\n--- 4) stepDeg 0.5 > stepDeg 1 en score ---");
const r4a = computeFarConfidence({
  source: "SURFACE_DSM",
  algorithm: "LEGACY",
  gridResolutionMeters: 10,
  dataCoverageRatio: 0.9,
  stepDeg: 0.5,
});
const r4b = computeFarConfidence({
  source: "SURFACE_DSM",
  algorithm: "LEGACY",
  gridResolutionMeters: 10,
  dataCoverageRatio: 0.9,
  stepDeg: 1,
});
assert(r4a.score > r4b.score, "stepDeg 0.5 donne score plus élevé que stepDeg 1");

// --- 5) Aucun obstacleDistances → fallback neutre ---
console.log("\n--- 5) Aucun obstacleDistances → fallback neutre ---");
const r5 = computeFarConfidence({
  source: "SURFACE_DSM",
  algorithm: "LEGACY",
  gridResolutionMeters: 10,
  dataCoverageRatio: 0.95,
  obstacleDistancesMeters: [],
  stepDeg: 1,
});
assert(r5.breakdown.geometryWeight === 8, "geometryWeight = 8 (neutre) sans obstacles");
assert(r5.score >= 0 && r5.score <= 100, "score dans [0,100]");

// --- Résumé ---
console.log("\n--- RÉSUMÉ ---");
console.log("Passed: " + passed + ", Failed: " + failed);

if (failed > 0) {
  console.log("\n❌ FAIL");
  process.exit(1);
}
console.log("\n✅ PASS");
process.exit(0);
