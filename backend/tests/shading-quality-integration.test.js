/**
 * CP-FAR-011 — Tests d'intégration shadingQuality dans pipeline shading
 * Usage: node tests/shading-quality-integration.test.js
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";

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

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

const geometry = {
  frozenBlocks: [{ panels: [panel] }],
};

(async () => {
  // --- 1) Pipeline complet → shadingQuality présent ---
  console.log("\n--- 1) Pipeline complet → shadingQuality présent ---");
  const shadingResult = await computeCalpinageShading({
    lat: 48.8566,
    lon: 2.3522,
    geometry,
  });
  const hasGps = true;
  const hasPanels = hasPanelsInGeometry(geometry);
  const shading = buildStructuredShading(shadingResult, hasGps, hasPanels, {});

  assert(shading.shadingQuality != null, "shadingQuality présent");
  assert(typeof shading.shadingQuality.score === "number", "shadingQuality.score présent");
  assert(
    ["A+", "A", "B", "C", "D"].includes(shading.shadingQuality.grade),
    "shadingQuality.grade valide"
  );
  assert(shading.shadingQuality.inputs != null, "shadingQuality.inputs présent");

  // --- 2) Score cohérent avec near/far ---
  assert(
    shading.shadingQuality.inputs.near === shading.near?.totalLossPct,
    "inputs.near === near.totalLossPct"
  );
  assert(
    shading.shadingQuality.inputs.far === shading.far?.totalLossPct,
    "inputs.far === far.totalLossPct"
  );

  // --- 3) Pas de régression sur lossPct ---
  assert(
    shading.totalLossPct === shadingResult.totalLossPct,
    "totalLossPct inchangé"
  );
  assert(
    shading.far?.confidenceScore != null,
    "confidenceScore (CP-FAR-010) conservé"
  );

  // --- Résumé ---
  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  console.log("\nExemple shading:", JSON.stringify({
    near: shading.near,
    far: { ...shading.far, dataCoverage: shading.far?.dataCoverage ? "(présent)" : null },
    combined: shading.combined,
    shadingQuality: shading.shadingQuality,
  }, null, 2));

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
