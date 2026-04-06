/**
 * CP-FAR-008 — Tests unitaires decode GeoTIFF
 * Usage: node tests/dsm-decode-geotiff.test.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodeGeotiffToFloatGrid } from "../services/horizon/providers/dsm/dsmProviderHttpGeotiff.js";
import { dsmGridToHorizonMask } from "../services/horizon/providers/dsm/dsmToHorizonMask.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "fixtures", "dsm", "sample.tif");

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
  console.log("\n--- A) Decode GeoTIFF fixture ---");

  if (!fs.existsSync(FIXTURE_PATH)) {
    fail("Fixture exists", "Run: node scripts/generate-dsm-fixture.js");
    console.log("\n--- RÉSUMÉ ---");
    console.log("Passed: " + passed + ", Failed: " + failed);
    process.exit(failed > 0 ? 1 : 0);
  }

  const buffer = fs.readFileSync(FIXTURE_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const decoded = await decodeGeotiffToFloatGrid(arrayBuffer);

  assert(decoded.width === 16, "width === 16");
  assert(decoded.height === 16, "height === 16");
  assert(decoded.grid instanceof Float32Array, "grid is Float32Array");
  assert(decoded.grid.length === 256, "grid.length === 256");
  assert(decoded.origin && typeof decoded.origin.lat === "number", "origin.lat present");
  assert(decoded.origin && typeof decoded.origin.lon === "number", "origin.lon present");
  assert(typeof decoded.stepMeters === "number" && decoded.stepMeters > 0, "stepMeters > 0");

  const centerIdx = 7 * 16 + 7;
  const centerVal = decoded.grid[centerIdx];
  assert(centerVal >= 55 && centerVal <= 65, "center value ~60 (gaussian peak)");

  console.log("\n--- B) dsmGridToHorizonMask ---");
  const { mask } = dsmGridToHorizonMask(
    decoded,
    48.85,
    2.35,
    500,
    2
  );
  assert(Array.isArray(mask), "mask is array");
  assert(mask.length === 180, "mask.length === 180 (360/2)");
  const maskOk = mask.every((m) => typeof m.az === "number" && typeof m.elev === "number");
  assert(maskOk, "mask entries {az, elev}");

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
