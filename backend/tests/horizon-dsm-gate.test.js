/**
 * POINT 6D — Gate terrain DSM : sélection réelle vs relief-only.
 */

import {
  isSurfaceDsmTerrainReady,
  getHorizonCacheDsmSuffix,
  surfaceDsmTerrainNotReadyNotes,
} from "../services/horizon/horizonDsmGate.js";

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

function main() {
  const save = { ...process.env };

  try {
    process.env.HORIZON_DSM_ENABLED = "false";
    delete process.env.DSM_ENABLE;
    delete process.env.DSM_PROVIDER_TYPE;
    delete process.env.DSM_GEOTIFF_URL_TEMPLATE;
    delete process.env.DSM_PROVIDER;
    assert(!isSurfaceDsmTerrainReady(), "1) disabled → pas prêt");

    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_PROVIDER_TYPE = "STUB";
    assert(!isSurfaceDsmTerrainReady(), "2) STUB seul → pas prêt");
    assert(getHorizonCacheDsmSuffix() === ":dsm=0", "2b) suffix relief");
    assert(surfaceDsmTerrainNotReadyNotes().length > 0, "2c) notes non vides");

    process.env.DSM_PROVIDER_TYPE = "HTTP_GEOTIFF";
    process.env.DSM_ENABLE = "true";
    process.env.DSM_GEOTIFF_URL_TEMPLATE = "https://example.com/{z}/{x}/{y}.tif";
    assert(isSurfaceDsmTerrainReady(), "3) HTTP+URL+enable → prêt");
    assert(getHorizonCacheDsmSuffix() === ":dsm=geotiff", "3b) suffix geotiff");

    process.env.DSM_PROVIDER = "LOCAL";
    delete process.env.DSM_PROVIDER_TYPE;
    assert(isSurfaceDsmTerrainReady(), "4) LOCAL → prêt");
    assert(getHorizonCacheDsmSuffix() === ":dsm=real", "4b) suffix real");

    process.env.DSM_PROVIDER = "AUTO";
    process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";
    process.env.DSM_ENABLE = "true";
    assert(isSurfaceDsmTerrainReady(), "5) IGN+enable → prêt");
    assert(getHorizonCacheDsmSuffix() === ":dsm=ign", "5b) suffix ign");
  } finally {
    Object.assign(process.env, save);
  }

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
