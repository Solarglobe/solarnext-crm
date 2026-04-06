/**
 * CALPINAGE-DATA-FINAL-LOCK — Intégrité versioning
 * Usage: node tests/calpinage-data-versioning-integrity.test.js
 */

import { V2_SCHEMA_VERSION } from "../services/calpinage/calpinageShadingNormalizer.js";
import { adaptLegacyShadingToV2, getNormalizedShadingFromGeometry } from "../services/calpinage/calpinageShadingLegacyAdapter.js";

let passed = 0;
let failed = 0;

function ok(label) { console.log("✅ " + label); passed++; }
function fail(label, msg) { console.log("❌ " + label + ": " + msg); failed++; }
function assert(cond, label, msg) { if (cond) ok(label); else fail(label, msg || "assertion failed"); }

// --- 1) Nouvelle étude → schemaVersion === "v2" (simulé via toSave) ---
console.log("\n--- 1) schemaVersion v2 ---");
assert(V2_SCHEMA_VERSION === "v2", "V2_SCHEMA_VERSION === v2");

// --- 2) Lecture legacy → adaptée vers v2 ---
console.log("\n--- 2) Legacy sans version → adaptée ---");
const legacyGeometry = { shading: { totalLossPct: 0, near: { totalLossPct: 0 }, far: { totalLossPct: 0 } } };
const { shading } = getNormalizedShadingFromGeometry(legacyGeometry);
assert(shading.near != null && shading.far != null && shading.combined != null, "Legacy adapté vers V2");
assert(shading.shadingQuality != null, "shadingQuality présent");

// --- 3) Double sauvegarde → stable (adapt deux fois = même résultat) ---
console.log("\n--- 3) Double adapt → stable ---");
const adapted1 = adaptLegacyShadingToV2(legacyGeometry.shading, null);
const adapted2 = adaptLegacyShadingToV2(adapted1, "v2");
assert(JSON.stringify(adapted1) === JSON.stringify(adapted2), "Double adapt idempotent");

// --- 4) Geometry avec schemaVersion v2 ---
console.log("\n--- 4) Geometry v2 ---");
const v2Geometry = { schemaVersion: "v2", shading: { near: { totalLossPct: 5 }, far: { source: "RELIEF_ONLY", totalLossPct: 10, dataCoverage: {} }, combined: { totalLossPct: 15 }, shadingQuality: { score: 80, grade: "A", inputs: { near: 5, far: 10, resolution_m: 25, coveragePct: 1 } } } };
const { shading: s2, schemaVersion: sv } = getNormalizedShadingFromGeometry(v2Geometry);
assert(sv === "v2", "schemaVersion extrait");
assert(s2.near.totalLossPct === 5, "V2 préservé");

console.log("\n--- RÉSUMÉ ---");
console.log("Passed: " + passed + ", Failed: " + failed);
if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
console.log("\n✅ PASS");
process.exit(0);
