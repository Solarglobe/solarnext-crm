/**
 * CP-FAR-013 — Tests structure V2 officielle
 * Usage: node tests/calpinage-shading-v2-structure.test.js
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";

let passed = 0;
let failed = 0;

function ok(label) { console.log("✅ " + label); passed++; }
function fail(label, msg) { console.log("❌ " + label + ": " + msg); failed++; }
function assert(cond, label, msg) { if (cond) ok(label); else fail(label, msg || "assertion failed"); }

const panel = { id: "p1", polygon: [{ x: 50, y: 50 }, { x: 60, y: 50 }, { x: 60, y: 60 }, { x: 50, y: 60 }] };
const geometry = { frozenBlocks: [{ panels: [panel] }] };

const INTERNAL_FIELDS = ["farLossPct", "nearLossPct", "confidence", "mask", "elapsedMs", "earlyExitCount", "samplerStats"];

function hasNoInternalFields(obj) {
  const str = JSON.stringify(obj);
  return !INTERNAL_FIELDS.some((f) => str.includes(`"${f}"`));
}

(async () => {
  // --- 1) Structure conforme V2 ---
  console.log("\n--- 1) Structure conforme V2 ---");
  const shadingResult = await computeCalpinageShading({ lat: 48.8566, lon: 2.3522, geometry });
  const rawShading = buildStructuredShading(shadingResult, true, true, {});
  const meta = shadingResult.farMetadata
    ? { step_deg: shadingResult.farMetadata.step_deg, resolution_m: shadingResult.farMetadata.resolution_m, algorithm: shadingResult.farMetadata.meta?.algorithm }
    : {};
  const shading = normalizeCalpinageShading(rawShading, meta);

  assert(shading.near != null && typeof shading.near.totalLossPct === "number", "shading.near.totalLossPct");
  assert(shading.far != null && typeof shading.far.totalLossPct === "number", "shading.far.totalLossPct");
  assert(shading.combined != null && typeof shading.combined.totalLossPct === "number", "shading.combined.totalLossPct");
  assert(shading.shadingQuality != null && typeof shading.shadingQuality.score === "number", "shading.shadingQuality");
  assert(shading.far.algorithm != null, "far.algorithm présent");
  assert(shading.far.dataCoverage != null && typeof shading.far.dataCoverage.ratio === "number", "far.dataCoverage.ratio");

  // --- 2) Aucune propriété interne exposée ---
  console.log("\n--- 2) Pas de champs internes ---");
  assert(hasNoInternalFields(shading), "pas de farLossPct/confidence/mask etc à la racine");

  // --- 3) SmartPitch utilise near/far/combined totalLossPct ---
  console.log("\n--- 3) totalLossPct exploitables ---");
  const nearPct = shading.near.totalLossPct;
  const farPct = shading.far.totalLossPct;
  const combinedPct = shading.combined.totalLossPct;
  assert(nearPct >= 0 && nearPct <= 100, "near.totalLossPct [0,100]");
  assert(farPct >= 0 && farPct <= 100, "far.totalLossPct [0,100]");
  assert(combinedPct >= 0 && combinedPct <= 100, "combined.totalLossPct [0,100]");

  // --- 4) dataCoverage.ratio ∈ [0..1] ---
  console.log("\n--- 4) dataCoverage.ratio borné ---");
  const ratio = shading.far.dataCoverage?.ratio ?? -1;
  assert(ratio >= 0 && ratio <= 1, "dataCoverage.ratio ∈ [0,1]");

  // --- 5) resolution_m défini ---
  console.log("\n--- 5) resolution_m défini ---");
  assert(typeof shading.far.resolution_m === "number", "far.resolution_m number");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  console.log("\nExemple V2:", JSON.stringify(shading, null, 2));
  if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
  console.log("\n✅ PASS");
  process.exit(0);
})();
