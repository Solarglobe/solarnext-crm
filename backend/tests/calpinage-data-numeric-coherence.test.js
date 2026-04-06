/**
 * CALPINAGE-DATA-FINAL-LOCK — Cohérence numérique
 * Usage: node tests/calpinage-data-numeric-coherence.test.js
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

(async () => {
  const shadingResult = await computeCalpinageShading({ lat: 48.8566, lon: 2.3522, geometry });
  const hasPanels = hasPanelsInGeometry(geometry);
  const rawShading = buildStructuredShading(shadingResult, true, hasPanels, {});
  const meta = shadingResult.farMetadata
    ? { step_deg: shadingResult.farMetadata.step_deg, resolution_m: shadingResult.farMetadata.resolution_m, algorithm: shadingResult.farMetadata.meta?.algorithm }
    : {};
  const shading = normalizeCalpinageShading(rawShading, meta);

  // --- shadingQuality.inputs.near === shading.near.totalLossPct ---
  console.log("\n--- 1) inputs.near === near.totalLossPct ---");
  assert(shading.shadingQuality.inputs.near === shading.near.totalLossPct, "inputs.near cohérent");

  // --- shadingQuality.inputs.far === shading.far.totalLossPct ---
  console.log("\n--- 2) inputs.far === far.totalLossPct ---");
  assert(shading.shadingQuality.inputs.far === shading.far.totalLossPct, "inputs.far cohérent");

  // --- shadingQuality.inputs.coveragePct === shading.far.dataCoverage.ratio ---
  console.log("\n--- 3) inputs.coveragePct ≈ dataCoverage.ratio ---");
  const covInput = shading.shadingQuality.inputs.coveragePct ?? -1;
  const covRatio = shading.far.dataCoverage?.ratio ?? -1;
  assert(Math.abs(covInput - covRatio) < 1e-6, "coveragePct cohérent");

  // --- combined.totalLossPct cohérent avec totalLossPct calculé ---
  console.log("\n--- 4) combined.totalLossPct cohérent ---");
  assert(Math.abs(shading.combined.totalLossPct - shadingResult.totalLossPct) < 0.5, "combined ≈ totalLossPct (<0.5%)");

  // --- ratio ∈ [0..1] ---
  console.log("\n--- 5) dataCoverage.ratio ∈ [0..1] ---");
  const ratio = shading.far.dataCoverage?.ratio ?? -1;
  assert(ratio >= 0 && ratio <= 1, "ratio borné");

  // --- totalLossPct >= 0 ---
  console.log("\n--- 6) totalLossPct >= 0 ---");
  assert(shading.near.totalLossPct >= 0 && shading.far.totalLossPct >= 0 && shading.combined.totalLossPct >= 0, "pertes >= 0");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
  console.log("\n✅ PASS");
  process.exit(0);
})();
