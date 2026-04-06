/**
 * CP-FAR-008 — Tests DSM réel (LOCAL fixtures)
 * A) DSM présent (LOCAL) => meta.source = DSM_REAL, horizonMask non vide
 * B) DSM absent/erreur => fallback RELIEF_ONLY, meta.source = RELIEF_ONLY
 * Usage: node scripts/test-horizon-dsm-real.js
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });

const { computeHorizonMaskAuto } = await import("../services/horizon/providers/horizonProviderSelector.js");

const params = { lat: 48.8566, lon: 2.3522, radius_m: 500, step_deg: 2 };

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

async function main() {
  const origEnabled = process.env.HORIZON_DSM_ENABLED;
  const origProvider = process.env.DSM_PROVIDER;

  try {
    console.log("\n--- A) DSM présent (LOCAL) => meta.source = DSM_REAL ---");
    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_PROVIDER = "LOCAL";

    const resultA = await computeHorizonMaskAuto(params);

    assert(resultA.source === "SURFACE_DSM", "source === SURFACE_DSM");
    assert(resultA.meta != null, "meta présent");
    assert(resultA.meta.source === "DSM_REAL", "meta.source === DSM_REAL");
    assert(
      resultA.meta.qualityScore != null && resultA.meta.qualityScore > 0,
      "meta.qualityScore > 0"
    );
    assert(Array.isArray(resultA.mask) && resultA.mask.length > 0, "horizonMask non vide");
    assert(resultA.mask.length === 180, "mask.length === 180 (360/2)");
    assert(
      resultA.mask.every((m) => typeof m.az === "number" && typeof m.elev === "number"),
      "mask entries {az, elev}"
    );

    console.log("\n--- B) DSM absent (flag OFF) => fallback RELIEF_ONLY ---");
    process.env.HORIZON_DSM_ENABLED = "false";
    process.env.DSM_PROVIDER = "LOCAL";

    const resultB = await computeHorizonMaskAuto(params);

    assert(resultB.source === "RELIEF_ONLY", "source === RELIEF_ONLY");
    assert(resultB.meta != null, "meta présent");
    assert(resultB.meta.source === "RELIEF_ONLY", "meta.source === RELIEF_ONLY");
    assert(Array.isArray(resultB.mask) && resultB.mask.length > 0, "horizonMask non vide");

    console.log("\n--- C) DSM LOCAL vs RELIEF_ONLY — masques différents ---");
    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_PROVIDER = "LOCAL";
    const maskDsm = await computeHorizonMaskAuto(params);
    process.env.HORIZON_DSM_ENABLED = "false";
    const maskRelief = await computeHorizonMaskAuto(params);

    const dsmStr = JSON.stringify(maskDsm.mask);
    const reliefStr = JSON.stringify(maskRelief.mask);
    assert(dsmStr !== reliefStr, "DSM_REAL mask ≠ RELIEF_ONLY mask (données différentes)");

    console.log("\n--- Exemple horizonMask (résumé) avec meta.source ---");
    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_PROVIDER = "LOCAL";
    const example = await computeHorizonMaskAuto(params);
    console.log(
      JSON.stringify(
        {
          source: example.source,
          meta: example.meta,
          maskLength: example.mask?.length,
          maskSample: example.mask?.slice(0, 3),
        },
        null,
        2
      )
    );
  } finally {
    if (origEnabled !== undefined) process.env.HORIZON_DSM_ENABLED = origEnabled;
    else delete process.env.HORIZON_DSM_ENABLED;
    if (origProvider !== undefined) process.env.DSM_PROVIDER = origProvider;
    else delete process.env.DSM_PROVIDER;
  }

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
