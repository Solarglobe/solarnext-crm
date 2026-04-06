/**
 * CALPINAGE-DATA-FINAL-LOCK — Test idempotence normalisation
 * Usage: node tests/calpinage-data-idempotence.test.js
 */

import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";
import { adaptLegacyShadingToV2 } from "../services/calpinage/calpinageShadingLegacyAdapter.js";

let passed = 0;
let failed = 0;

function ok(label) { console.log("✅ " + label); passed++; }
function fail(label, msg) { console.log("❌ " + label + ": " + msg); failed++; }
function assert(cond, label, msg) { if (cond) ok(label); else fail(label, msg || "assertion failed"); }

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- 1) normalize(normalize(data)) deepEqual normalize(data) ---
console.log("\n--- 1) Double normalisation idempotente ---");
const v2Data = {
  near: { totalLossPct: 3 },
  far: { source: "SURFACE_DSM", algorithm: "LEGACY", radius_m: 500, step_deg: 2, resolution_m: 10, totalLossPct: 8, confidenceScore: 70, confidenceLevel: "HIGH", confidenceBreakdown: {}, dataCoverage: { ratio: 0.95, effectiveRadiusMeters: 500, gridResolutionMeters: 10, provider: "HTTP_GEOTIFF" } },
  combined: { totalLossPct: 11 },
  shadingQuality: { score: 85, grade: "A", inputs: { near: 3, far: 8, resolution_m: 10, coveragePct: 0.95 } },
};
const n1 = normalizeCalpinageShading(v2Data);
const n2 = normalizeCalpinageShading(n1);
assert(deepEqual(n1, n2), "normalize(normalize(data)) === normalize(data)");

// --- 2) Legacy data → adapt → normalize → stable ---
console.log("\n--- 2) Legacy → adapt → stable ---");
const legacyData = { totalLossPct: 10, near: { totalLossPct: 4 }, far: { source: "RELIEF_ONLY", totalLossPct: 6 } };
const adapted = adaptLegacyShadingToV2(legacyData, null);
const adapted2 = normalizeCalpinageShading(adapted);
assert(deepEqual(adapted, adapted2), "Legacy adapté puis normalisé = stable");

// --- 3) V2 data → normalize → inchangé (structure) ---
console.log("\n--- 3) V2 data → normalize → structure conservée ---");
const normalized = normalizeCalpinageShading(v2Data);
assert(normalized.near.totalLossPct === 3, "near.totalLossPct conservé");
assert(normalized.far.source === "SURFACE_DSM", "far.source conservé");
assert(normalized.shadingQuality.grade === "A", "shadingQuality.grade conservé");

console.log("\n--- RÉSUMÉ ---");
console.log("Passed: " + passed + ", Failed: " + failed);
if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
console.log("\n✅ PASS");
process.exit(0);
