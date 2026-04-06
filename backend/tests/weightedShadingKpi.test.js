/**
 * Moyenne pondérée ombrage multi-pan (alignement KPI / production).
 * Usage: node backend/tests/weightedShadingKpi.test.js
 */

import { computeWeightedShadingCombinedPct } from "../services/shading/weightedShadingKpi.js";

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

assert(computeWeightedShadingCombinedPct(null) == null, "null → null");
assert(computeWeightedShadingCombinedPct([]) == null, "[] → null");
assert(
  computeWeightedShadingCombinedPct([{ panelCount: 10, shadingCombinedPct: 5 }]) === 5,
  "un pan 10 mod @ 5% → 5"
);
assert(
  Math.abs(
    computeWeightedShadingCombinedPct([
      { panelCount: 6, shadingCombinedPct: 4.8 },
      { panelCount: 4, shadingCombinedPct: 5.2 },
    ]) - (6 * 4.8 + 4 * 5.2) / 10
  ) < 1e-6,
  "deux pans 6+4 mod → moyenne pondérée 10"
);
assert(
  computeWeightedShadingCombinedPct([{ panelCount: 0, shadingCombinedPct: 50 }]) == null,
  "poids nul → null (fallback payload raycast ailleurs)"
);

console.log("\nPassed: " + passed + ", Failed: " + failed);
if (failed > 0) process.exit(1);
process.exit(0);
