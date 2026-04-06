/**
 * Contrat vérité officielle shading (backend).
 * Usage: node backend/tests/officialShadingTruth.test.js
 */

import {
  getOfficialGlobalShadingLossPct,
  warnIfOfficialShadingRootMismatch,
} from "../services/shading/officialShadingTruth.js";

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

assert(getOfficialGlobalShadingLossPct(null) === null, "null input");
assert(
  getOfficialGlobalShadingLossPct({ combined: { totalLossPct: 12.3 } }) === 12.3,
  "combined.totalLossPct"
);
assert(
  getOfficialGlobalShadingLossPct({ combined: { totalLossPct: 150 } }) === 100,
  "clamp haut"
);
assert(
  getOfficialGlobalShadingLossPct({ totalLossPct: 7, near: { totalLossPct: 99 } }) === 7,
  "ne lit pas near comme global"
);
assert(
  getOfficialGlobalShadingLossPct({
    shadingQuality: { blockingReason: "missing_gps" },
    combined: { totalLossPct: 5 },
  }) === null,
  "GPS bloqué → null"
);

warnIfOfficialShadingRootMismatch({ combined: { totalLossPct: 10 }, totalLossPct: 10 });
assert(true, "warnIfOfficialShadingRootMismatch sans divergence ne jette pas");

console.log("\nPassed: " + passed + ", Failed: " + failed);
if (failed > 0) process.exit(1);
process.exit(0);
