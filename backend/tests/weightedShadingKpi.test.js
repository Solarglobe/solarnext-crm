/**
 * Moyenne ponderee ombrage multi-pan (alignement KPI / production).
 * Usage: node backend/tests/weightedShadingKpi.test.js
 */

import {
  computeWeightedShadingCombinedPct,
  ensureRoofPansCarryProductionShading,
} from "../services/shading/weightedShadingKpi.js";

let passed = 0;
let failed = 0;
function ok(label) {
  console.log("OK " + label);
  passed++;
}
function fail(label, message) {
  console.log("FAIL " + label + ": " + message);
  failed++;
}
function assert(condition, label, message) {
  if (condition) ok(label);
  else fail(label, message || "");
}

assert(computeWeightedShadingCombinedPct(null) == null, "null -> null");
assert(computeWeightedShadingCombinedPct([]) == null, "[] -> null");
assert(
  computeWeightedShadingCombinedPct([{ panelCount: 10, shadingCombinedPct: 5 }]) === 5,
  "un pan 10 modules a 5% -> 5"
);
assert(
  Math.abs(
    computeWeightedShadingCombinedPct([
      { panelCount: 6, shadingCombinedPct: 4.8 },
      { panelCount: 4, shadingCombinedPct: 5.2 },
    ]) - (6 * 4.8 + 4 * 5.2) / 10
  ) < 1e-6,
  "deux pans 6+4 modules -> moyenne ponderee"
);
assert(
  computeWeightedShadingCombinedPct([{ panelCount: 0, shadingCombinedPct: 50 }]) == null,
  "poids nul -> null"
);

const carried = ensureRoofPansCarryProductionShading(
  [
    { id: "a", panelCount: 8, shadingCombinedPct: 0 },
    { id: "b", panelCount: 8, shadingCombinedPct: 0 },
  ],
  3.9
);
assert(
  carried.every((p) => p.shadingCombinedPct === 3.9),
  "perte globale calpinage propagee aux pans si les pans sont a 0"
);
assert(
  computeWeightedShadingCombinedPct(carried) === 3.9,
  "perte globale propagee impacte le KPI utilise par la production"
);

const preserved = ensureRoofPansCarryProductionShading(
  [
    { id: "a", panelCount: 8, shadingCombinedPct: 2 },
    { id: "b", panelCount: 8, shadingCombinedPct: 6 },
  ],
  3.9
);
assert(
  preserved[0].shadingCombinedPct === 2 && preserved[1].shadingCombinedPct === 6,
  "pertes par pan existantes conservees"
);

console.log("\nPassed: " + passed + ", Failed: " + failed);
if (failed > 0) process.exit(1);
process.exit(0);
