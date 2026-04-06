/**
 * CALPINAGE-DATA-FINAL-LOCK — Vérification consommateurs (SmartPitch/PDF/API)
 * Usage: node tests/calpinage-data-consumers.test.js
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

const FORBIDDEN_ACCESS = ["mask", "elevationsDeg", "samplerStats", "earlyExitCount", "rawGrid", "elapsedMs", "timing", "debug"];

(async () => {
  const shadingResult = await computeCalpinageShading({ lat: 48.8566, lon: 2.3522, geometry });
  const hasPanels = hasPanelsInGeometry(geometry);
  const rawShading = buildStructuredShading(shadingResult, true, hasPanels, {});
  const meta = shadingResult.farMetadata
    ? { step_deg: shadingResult.farMetadata.step_deg, resolution_m: shadingResult.farMetadata.resolution_m, algorithm: shadingResult.farMetadata.meta?.algorithm }
    : {};
  const shading = normalizeCalpinageShading(rawShading, meta);

  // --- solarnextPayloadBuilder n'accède qu'à: near.totalLossPct, far.totalLossPct, combined.totalLossPct, shadingQuality.score ---
  console.log("\n--- 1) Accès SmartPitch/API (champs autorisés) ---");
  const nearPct = shading.near?.totalLossPct;
  const farPct = shading.far?.totalLossPct;
  const combinedPct = shading.combined?.totalLossPct;
  const qualityScore = shading.shadingQuality?.score;

  assert(typeof nearPct === "number", "shading.near.totalLossPct exploitable");
  assert(typeof farPct === "number", "shading.far.totalLossPct exploitable");
  assert(typeof combinedPct === "number", "shading.combined.totalLossPct exploitable");
  assert(typeof qualityScore === "number", "shadingQuality.score exploitable");

  // --- Aucun champ interne présent ---
  console.log("\n--- 2) Pas de champs internes ---");
  const jsonStr = JSON.stringify(shading);
  const hasForbidden = FORBIDDEN_ACCESS.some((f) => jsonStr.includes(`"${f}"`));
  assert(!hasForbidden, "Aucun mask/samplerStats/elapsedMs etc présent");

  // --- 3) solarnextAdapter utilise shading_loss_pct (pas shading object) ---
  console.log("\n--- 3) solarnextAdapter utilise shading_loss_pct ---");
  const shadingLossPct = shadingResult.totalLossPct;
  assert(typeof shadingLossPct === "number", "shading_loss_pct disponible");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
  console.log("\n✅ PASS");
  process.exit(0);
})();
