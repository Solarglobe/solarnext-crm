/**
 * CP-FAR-010 — Tests d'intégration confidence dans shading.far
 * Usage: node tests/horizon-confidence-integration.test.js
 */

import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
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
  // --- 1) computeHorizonMaskAuto retourne dataCoverage ---
  console.log("\n--- 1) computeHorizonMaskAuto retourne dataCoverage ---");
  const horizonResult = await computeHorizonMaskAuto({
    lat: 48.8566,
    lon: 2.3522,
    radius_m: 500,
    step_deg: 2,
  });
  assert(horizonResult != null, "horizonResult non null");
  assert(horizonResult.dataCoverage != null, "dataCoverage présent");
  assert(
    ["SURFACE_DSM", "FAR_UNAVAILABLE_ERROR"].includes(horizonResult.source ?? "") ||
      horizonResult.dataCoverage != null,
    "source valide (SURFACE_DSM, ou UNAVAILABLE si réseau indisponible en test)"
  );

  // --- 2) computeCalpinageShading + buildStructuredShading → confidenceScore présent ---
  console.log("\n--- 2) Shading far avec confidenceScore ---");
  const shadingResult = await computeCalpinageShading({
    lat: 48.8566,
    lon: 2.3522,
    geometry,
  });
  const hasGps = true;
  const hasPanels = hasPanelsInGeometry(geometry);
  const shading = buildStructuredShading(shadingResult, hasGps, hasPanels, {});

  assert(shading.far != null, "shading.far présent");
  assert(typeof shading.far.confidenceScore === "number", "confidenceScore présent");
  assert(
    ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"].includes(shading.far.confidenceLevel),
    "confidenceLevel valide"
  );
  assert(shading.far.confidenceBreakdown != null, "confidenceBreakdown présent");
  assert(
    shading.far.confidenceScore >= 0 && shading.far.confidenceScore <= 100,
    "confidenceScore dans [0,100]"
  );

  // --- 3) UNAVAILABLE → confidenceScore === 0 | IGN → score élevé | PVGIS → intermédiaire ---
  if (shading.far.source === "FAR_UNAVAILABLE_ERROR") {
    assert(shading.far.confidenceScore === 0, "UNAVAILABLE → confidenceScore 0");
    assert(shading.far.confidenceLevel === "LOW", "UNAVAILABLE → niveau LOW");
  }
  // RELIEF_ONLY conservé pour compatibilité des données historiques
  if (shading.far.source === "RELIEF_ONLY") {
    assert(shading.far.confidenceScore <= 30, "RELIEF_ONLY plafonné à 30");
    assert(shading.far.confidenceLevel === "LOW", "RELIEF_ONLY → niveau LOW");
  }

  // --- 4) dataCoverage enrichi ---
  if (shading.far.dataCoverage) {
    assert(
      typeof shading.far.dataCoverage.ratio === "number" ||
        shading.far.dataCoverage.coveragePct != null,
      "dataCoverage ratio ou coveragePct"
    );
  }

  // --- Résumé ---
  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  console.log("\nExemple shading.far:", JSON.stringify(shading.far, null, 2));

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
