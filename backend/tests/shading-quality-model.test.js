/**
 * CP-FAR-011 — Tests unitaires modèle qualité ombrage
 * Usage: node tests/shading-quality-model.test.js
 */

import { computeShadingQuality } from "../services/shading/quality/shadingQualityModel.js";

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

// --- 1) near=1, far=0.5, res=5, coverage=1 → score > 95, grade A+ ---
console.log("\n--- 1) near=1, far=0.5, res=5, coverage=1 → score > 95, grade A+ ---");
const r1 = computeShadingQuality({
  nearLossPct: 1,
  farLossPct: 0.5,
  resolutionMeters: 5,
  coverageRatio: 1,
});
assert(r1.score > 95, "score > 95");
assert(r1.grade === "A+", "grade A+");
assert(r1.inputs.near === 1, "inputs.near");
assert(r1.inputs.far === 0.5, "inputs.far");
assert(r1.inputs.resolution_m === 5, "inputs.resolution_m");

// --- 2) near=6, far=3, res=10, coverage=0.9 → grade A ou B ---
console.log("\n--- 2) near=6, far=3, res=10, coverage=0.9 → grade A ou B ---");
const r2 = computeShadingQuality({
  nearLossPct: 6,
  farLossPct: 3,
  resolutionMeters: 10,
  coverageRatio: 0.9,
});
assert(r2.grade === "A" || r2.grade === "B", "grade A ou B");

// --- 3) near=15, far=8 → grade C ou D ---
console.log("\n--- 3) near=15, far=8 → grade C ou D ---");
const r3 = computeShadingQuality({
  nearLossPct: 15,
  farLossPct: 8,
  resolutionMeters: 10,
  coverageRatio: 0.95,
});
assert(r3.grade === "C" || r3.grade === "D", "grade C ou D");

// --- 4) coverage faible pénalise ---
console.log("\n--- 4) coverage faible pénalise ---");
const r4a = computeShadingQuality({
  nearLossPct: 2,
  farLossPct: 1,
  resolutionMeters: 5,
  coverageRatio: 0.95,
});
const r4b = computeShadingQuality({
  nearLossPct: 2,
  farLossPct: 1,
  resolutionMeters: 5,
  coverageRatio: 0.4,
});
assert(r4b.score < r4a.score, "coverage faible réduit le score");

// --- 5) resolution >30 pénalise ---
console.log("\n--- 5) resolution >30 pénalise ---");
const r5a = computeShadingQuality({
  nearLossPct: 2,
  farLossPct: 1,
  resolutionMeters: 5,
  coverageRatio: 1,
});
const r5b = computeShadingQuality({
  nearLossPct: 2,
  farLossPct: 1,
  resolutionMeters: 50,
  coverageRatio: 1,
});
assert(r5b.score < r5a.score, "resolution >30m réduit le score");

// --- Résumé ---
console.log("\n--- RÉSUMÉ ---");
console.log("Passed: " + passed + ", Failed: " + failed);

if (failed > 0) {
  console.log("\n❌ FAIL");
  process.exit(1);
}
console.log("\n✅ PASS");
process.exit(0);
