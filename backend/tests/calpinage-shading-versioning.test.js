/**
 * CP-FAR-013 — Tests versioning shading V2
 * Usage: node tests/calpinage-shading-versioning.test.js
 */

import { normalizeCalpinageShading, V2_SCHEMA_VERSION } from "../services/calpinage/calpinageShadingNormalizer.js";
import { adaptLegacyShadingToV2, getNormalizedShadingFromGeometry } from "../services/calpinage/calpinageShadingLegacyAdapter.js";

let passed = 0;
let failed = 0;

function ok(label) { console.log("✅ " + label); passed++; }
function fail(label, msg) { console.log("❌ " + label + ": " + msg); failed++; }
function assert(cond, label, msg) { if (cond) ok(label); else fail(label, msg || "assertion failed"); }

// --- 1) Legacy data (sans schemaVersion) → adapter vers V2 ---
console.log("\n--- 1) Legacy sans schemaVersion → V2 ---");
const legacyShading = { totalLossPct: 10, near: { totalLossPct: 5 }, far: { source: "RELIEF_ONLY", totalLossPct: 5 } };
const adapted = adaptLegacyShadingToV2(legacyShading, null);
assert(adapted.near != null, "adapted.near présent");
assert(adapted.far != null, "adapted.far présent");
assert(adapted.combined != null, "adapted.combined présent");
assert(adapted.shadingQuality != null, "adapted.shadingQuality présent");
assert(typeof adapted.near.totalLossPct === "number", "near.totalLossPct number");

// --- 2) Nouveau data → contient schemaVersion "v2" ---
console.log("\n--- 2) schemaVersion v2 ---");
assert(V2_SCHEMA_VERSION === "v2", "V2_SCHEMA_VERSION === v2");

// --- 3) Double normalisation ne modifie pas structure ---
console.log("\n--- 3) Double normalisation idempotente ---");
const raw = {
  near: { totalLossPct: 3 },
  far: { source: "SURFACE_DSM", radius_m: 500, totalLossPct: 8, confidenceScore: 70, confidenceLevel: "HIGH", dataCoverage: { ratio: 0.95, effectiveRadiusMeters: 500, gridResolutionMeters: 10, provider: "HTTP_GEOTIFF" } },
  combined: { totalLossPct: 11 },
  shadingQuality: { score: 85, grade: "A", inputs: { near: 3, far: 8, resolution_m: 10, coveragePct: 0.95 } },
};
const n1 = normalizeCalpinageShading(raw);
const n2 = normalizeCalpinageShading(n1);
assert(JSON.stringify(n1) === JSON.stringify(n2), "double normalisation idempotente");

// --- 4) DeepEqual stable ---
console.log("\n--- 4) Structure stable ---");
assert(n1.near.totalLossPct === 3, "near.totalLossPct conservé");
assert(n1.far.source === "SURFACE_DSM", "far.source conservé");
assert(n1.far.confidenceScore === 70, "far.confidenceScore conservé");
assert(n1.shadingQuality.grade === "A", "shadingQuality.grade conservé");

// --- 5) getNormalizedShadingFromGeometry ---
console.log("\n--- 5) getNormalizedShadingFromGeometry ---");
const geomWithShading = { schemaVersion: "v2", shading: raw };
const { shading, schemaVersion } = getNormalizedShadingFromGeometry(geomWithShading);
assert(schemaVersion === "v2", "schemaVersion extrait");
assert(shading.near != null, "shading normalisé");

const geomLegacy = { shading: legacyShading };
const { shading: s2 } = getNormalizedShadingFromGeometry(geomLegacy);
assert(s2.combined != null, "legacy adapté");

// --- Résumé ---
console.log("\n--- RÉSUMÉ ---");
console.log("Passed: " + passed + ", Failed: " + failed);
if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
console.log("\n✅ PASS");
process.exit(0);
