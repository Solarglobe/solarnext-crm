/**
 * Gouvernance shading — diagnostic + cohérence avec resolve officiel.
 * Usage: node backend/tests/shadingGovernance.test.js
 */

import { diagnoseGlobalLossMismatchBackend, OFFICIAL_GLOBAL_LOSS_CONTRACT } from "../services/shading/shadingGovernance.js";
import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";

let passed = 0;
let failed = 0;
function ok(l) {
  console.log("✅ " + l);
  passed++;
}
function fail(l, m) {
  console.log("❌ " + l + ": " + m);
  failed++;
}
function assert(c, l, m) {
  if (c) ok(l);
  else fail(l, m || "");
}

assert(
  OFFICIAL_GLOBAL_LOSS_CONTRACT === "shading.combined.totalLossPct",
  "contrat global documenté (stable)"
);

const d1 = diagnoseGlobalLossMismatchBackend(10, 10.2, 0.5, "unit");
assert(d1.ok === true && !d1.delta, "diagnostic OK sous tolérance");

const d2 = diagnoseGlobalLossMismatchBackend(10, 12, 0.5, "unit");
assert(d2.ok === false && typeof d2.delta === "number", "diagnostic KO hors tolérance");

const d3 = diagnoseGlobalLossMismatchBackend(null, 5, 0.5, "unit");
assert(d3.skipped === true && d3.ok === true, "diagnostic skip si une valeur absente");

const shading = { combined: { totalLossPct: 7.5 } };
assert(
  resolveShadingTotalLossPct(shading, {}) === 7.5,
  "resolve aligné sur même structure que contrat gouvernance"
);

console.log("\nPassed: " + passed + ", Failed: " + failed);
if (failed > 0) process.exit(1);
process.exit(0);
