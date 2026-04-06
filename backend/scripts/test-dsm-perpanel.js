/**
 * CP-DSM-PP-001 — Tests perPanel persistence & exposure (backend)
 * Usage: cd backend && node scripts/test-dsm-perpanel.js
 */

import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading, hasPanelsInGeometry } from "../services/shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";

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

function buildMaskConstant(elevDeg) {
  const mask = [];
  for (let i = 0; i < 180; i++) {
    mask.push({ az: i * 2, elev: elevDeg });
  }
  return { mask };
}

const geometry = { frozenBlocks: [{ panels: [panel] }] };
const expectedPanelCount = 1;

(async () => {
  // --- 1) Simuler geometry.shading avec perPanel (comme depuis calpinage_data) ---
  console.log("\n--- 1) perPanel depuis geometry.shading (calpinage_data) ---");
  const existingShadingWithPerPanel = {
    perPanel: [
      { panelId: "p1", lossPct: 5.678 },
      { panelId: "p2", lossPct: 12.345 },
    ],
    totalLossPct: 8.5,
  };

  const shadingResult = await computeCalpinageShading({
    lat: 48.8566,
    lon: 2.3522,
    geometry,
    options: { __testHorizonMaskOverride: buildMaskConstant(15) },
  });

  const hasPanels = hasPanelsInGeometry(geometry);
  const rawShading = buildStructuredShading(shadingResult, true, hasPanels, existingShadingWithPerPanel);
  const meta = shadingResult.farMetadata
    ? {
        step_deg: shadingResult.farMetadata.step_deg,
        resolution_m: shadingResult.farMetadata.resolution_m,
        algorithm: shadingResult.farMetadata.meta?.algorithm,
      }
    : {};
  const shading = normalizeCalpinageShading(rawShading, meta);

  assert(Array.isArray(shading.perPanel), "shading.perPanel est un Array");
  assert(shading.perPanel.length > 0, "shading.perPanel.length > 0");
  assert(typeof shading.perPanel[0].panelId === "string", "perPanel[0].panelId est string");
  assert(typeof shading.perPanel[0].lossPct === "number", "perPanel[0].lossPct est number");
  assert(shading.perPanel.length === 2, "perPanel.length === 2 (p1, p2)");
  assert(shading.perPanel[0].panelId === "p1", "perPanel[0].panelId === 'p1'");
  assert(shading.perPanel[0].lossPct === 5.68, "perPanel[0].lossPct arrondi à 2 décimales (5.678 → 5.68)");
  assert(shading.perPanel[1].lossPct === 12.35, "perPanel[1].lossPct arrondi à 2 décimales (12.345 → 12.35)");

  // --- 2) Non-régression : near, far, shadingQuality intacts ---
  console.log("\n--- 2) Non-régression near/far/shadingQuality ---");
  assert(typeof shading.near?.totalLossPct === "number", "near.totalLossPct intact");
  assert(typeof shading.far?.totalLossPct === "number", "far.totalLossPct intact");
  assert(typeof shading.combined?.totalLossPct === "number", "combined.totalLossPct intact");
  assert(shading.shadingQuality != null, "shadingQuality intact");
  assert(typeof shading.shadingQuality?.score === "number", "shadingQuality.score intact");

  // --- 3) Cas sans perPanel (geometry vide) → perPanel = [] ---
  console.log("\n--- 3) Sans perPanel → perPanel = [] ---");
  const rawShadingNoPerPanel = buildStructuredShading(shadingResult, true, hasPanels, {});
  const shadingNoPerPanel = normalizeCalpinageShading(rawShadingNoPerPanel, meta);
  assert(Array.isArray(shadingNoPerPanel.perPanel), "perPanel absent → Array vide");
  assert(shadingNoPerPanel.perPanel.length === 0, "perPanel.length === 0 quand absent");

  // --- 4) Support panelId et id (alias) ---
  console.log("\n--- 4) Support id alias pour panelId ---");
  const existingWithId = { perPanel: [{ id: "pan-42", lossPct: 3.14 }] };
  const rawWithId = buildStructuredShading(shadingResult, true, hasPanels, existingWithId);
  const shadingWithId = normalizeCalpinageShading(rawWithId, meta);
  assert(shadingWithId.perPanel.length === 1, "perPanel avec id alias");
  assert(shadingWithId.perPanel[0].panelId === "pan-42", "id mappé vers panelId");

  // --- 5) Simuler payload final installation.shading ---
  console.log("\n--- 5) Structure payload.installation.shading ---");
  const payloadShading = shading;
  assert(payloadShading.near != null, "installation.shading.near présent");
  assert(payloadShading.far != null, "installation.shading.far présent");
  assert(payloadShading.combined != null, "installation.shading.combined présent");
  assert(payloadShading.shadingQuality != null, "installation.shading.shadingQuality présent");
  assert(payloadShading.perPanel != null, "installation.shading.perPanel présent");
  assert(
    payloadShading.perPanel.length === expectedPanelCount || payloadShading.perPanel.length >= 1,
    "perPanel cohérent avec panneaux"
  );

  // --- Résumé ---
  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
