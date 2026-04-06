/**
 * Near shading 3D canonique — passthrough JSON (buildStructuredShading → normalizeCalpinageShading).
 * Usage: node tests/calpinage-near-canonical3d-passthrough.test.js
 */

import { buildStructuredShading } from "../services/shading/shadingStructureBuilder.js";
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

const canonical3dStub = {
  pipelineVersion: "test-1",
  mode: "canonical_raycast",
  diagnostics: { reason: "ok" },
};

(() => {
  console.log("\n--- meta.nearCanonical3d → near.canonical3d ---");
  const nearOfficialStub = {
    engine: "legacy_polygon",
    officialLossPct: 5,
    legacyReferenceLossPct: 5,
    canonicalUsable: false,
    fallbackTriggered: true,
    canonicalRejectedBecause: "NO_ROOF_STATE",
    selectionReason: "Fallback legacy — canonical non retenu (NO_ROOF_STATE).",
  };
  const shadingResult = {
    nearLossPct: 5,
    farLossPct: 10,
    totalLossPct: 14.5,
    meta: { nearCanonical3d: canonical3dStub, nearOfficial: nearOfficialStub },
  };
  const raw = buildStructuredShading(shadingResult, true, true, {});
  assert(
    raw.near && raw.near.canonical3d === canonical3dStub,
    "buildStructuredShading place near.canonical3d depuis meta",
  );
  assert(
    raw.near && raw.near.official === nearOfficialStub,
    "buildStructuredShading place near.official depuis meta",
  );
  const norm = normalizeCalpinageShading(raw, {});
  assert(
    norm.near && norm.near.canonical3d === canonical3dStub,
    "normalizeCalpinageShading conserve near.canonical3d",
  );
  assert(
    norm.near && norm.near.official === nearOfficialStub,
    "normalizeCalpinageShading conserve near.official",
  );
  assert(
    norm.totalLossPct === norm.combined?.totalLossPct,
    "totalLossPct racine = miroir combined.totalLossPct (vérité unique)",
  );

  console.log("\n--- Snapshot geometry : existing near.canonical3d conservé ---");
  const existingShading = {
    near: { canonical3d: { pipelineVersion: "from_snapshot", mode: "legacy_fallback" } },
  };
  const raw2 = buildStructuredShading(
    { nearLossPct: 3, farLossPct: 0, totalLossPct: 3 },
    true,
    true,
    existingShading,
  );
  assert(
    raw2.near.canonical3d?.pipelineVersion === "from_snapshot",
    "existingShading.near.canonical3d préservé quand meta absent",
  );

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
})();
