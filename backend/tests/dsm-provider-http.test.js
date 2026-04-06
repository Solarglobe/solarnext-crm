/**
 * CP-FAR-008 — Tests intégration provider HTTP (mock)
 * Usage: node tests/dsm-provider-http.test.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nock from "nock";
import { getTileHeights } from "../services/horizon/providers/dsm/dsmProviderHttpGeotiff.js";

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
  if (!fs.existsSync(FIXTURE_PATH)) {
    console.log("Fixture manquante. Exécuter: node scripts/generate-dsm-fixture.js");
    process.exit(1);
  }

  const fixtureBuffer = fs.readFileSync(FIXTURE_PATH);

  const baseUrl = "https://dsm-test.example.com";
  const urlTemplate = baseUrl + "/{z}/{x}/{y}.tif";

  process.env.DSM_GEOTIFF_URL_TEMPLATE = urlTemplate;
  process.env.DSM_REQUEST_TIMEOUT_MS = "5000";

  const { x, y } = (() => {
    const lat = 48.8566, lon = 2.3522, z = 15;
    const n = Math.pow(2, z);
    const tx = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const ty = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: tx, y: ty };
  })();

  nock(baseUrl)
    .get(`/15/${x}/${y}.tif`)
    .reply(200, fixtureBuffer, { "Content-Type": "image/tiff" });

  console.log("\n--- A) getTileHeights (mock HTTP) ---");

  try {
    const result = await getTileHeights({
      lat: 48.8566,
      lon: 2.3522,
      radiusMeters: 500,
      resolutionMeters: 30,
    });

    assert(result.grid instanceof Float32Array, "grid is Float32Array");
    assert(result.width === 16, "width === 16");
    assert(result.height === 16, "height === 16");
    assert(result.meta?.provider === "HTTP_GEOTIFF", "meta.provider === HTTP_GEOTIFF");
    assert(result.meta?.source === urlTemplate, "meta.source correct");
  } catch (err) {
    fail("getTileHeights", err.message);
  }

  nock.cleanAll();

  console.log("\n--- B) 404 fallback (pas de throw, testé via surfaceDsmProvider) ---");
  ok("nock cleanup OK");

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
