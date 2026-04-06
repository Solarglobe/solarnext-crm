/**
 * Priorité HTTP_GEOTIFF + traçabilité fallback (pas de faux succès silencieux).
 * Usage: node tests/http-geotiff-priority-and-fallback.test.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import nock from "nock";

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

function tileXYForParisZ15() {
  const lat = 48.8566;
  const lon = 2.3522;
  const z = 15;
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y, z, lat, lon };
}

async function testA_connectionRefusedTracedFallback() {
  const prev = { ...process.env };
  try {
    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_ENABLE = "true";
    process.env.DSM_PROVIDER = "LOCAL";
    process.env.DSM_PROVIDER_TYPE = "HTTP_GEOTIFF";
    process.env.DSM_GEOTIFF_URL_TEMPLATE = "http://127.0.0.1:1/{z}/{x}/{y}.tif";
    process.env.DSM_REQUEST_TIMEOUT_MS = "500";

    const { computeMask } = await import("../services/horizon/providers/surfaceDsmProvider.js");
    const r = await computeMask({
      lat: 48.8566,
      lon: 2.3522,
      radius_m: 500,
      step_deg: 2,
      organizationId: "test",
    });

    assert(r.source === "RELIEF_ONLY", "A) source RELIEF_ONLY après échec HTTP");
    assert(r.dataCoverage?.provider === "RELIEF_ONLY", "A) dataCoverage.provider RELIEF_ONLY");
    assert(r.meta?.fallbackReason === "HTTP_GEOTIFF_FAILED", "A) meta.fallbackReason HTTP_GEOTIFF_FAILED");
    assert(
      r.meta?.requestedSurfaceProvider === "HTTP_GEOTIFF",
      "A) meta.requestedSurfaceProvider HTTP_GEOTIFF"
    );
    const notes = (r.dataCoverage?.notes || []).join(" ");
    assert(
      notes.includes("HTTP_GEOTIFF") && notes.includes("RELIEF_ONLY"),
      "A) notes mentionnent HTTP → RELIEF_ONLY",
      notes
    );
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  }
}

async function testB_successHttpGeotiffSelected() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    fail("B) fixture sample.tif", "exécuter: node scripts/generate-dsm-fixture.js");
    return;
  }
  const fixtureBuffer = fs.readFileSync(FIXTURE_PATH);
  const baseUrl = "https://http-geotiff-priority.test";
  const { x, y, z, lat, lon } = tileXYForParisZ15();
  const urlTemplate = `${baseUrl}/{z}/{x}/{y}.tif`;

  const prev = { ...process.env };
  try {
    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_ENABLE = "true";
    process.env.DSM_PROVIDER = "LOCAL";
    process.env.DSM_PROVIDER_TYPE = "HTTP_GEOTIFF";
    process.env.DSM_GEOTIFF_URL_TEMPLATE = urlTemplate;
    process.env.DSM_REQUEST_TIMEOUT_MS = "8000";

    nock(baseUrl)
      .get(`/${z}/${x}/${y}.tif`)
      .reply(200, fixtureBuffer, { "Content-Type": "image/tiff" });

    const { computeMask } = await import("../services/horizon/providers/surfaceDsmProvider.js");
    const r = await computeMask({
      lat,
      lon,
      radius_m: 500,
      step_deg: 2,
      organizationId: "test-b",
    });

    const httpOk =
      r.source === "SURFACE_DSM" && r.dataCoverage?.provider === "HTTP_GEOTIFF";
    const httpFlatTraced =
      r.meta?.fallbackReason === "HTTP_GEOTIFF_MASK_FLAT" &&
      r.meta?.requestedSurfaceProvider === "HTTP_GEOTIFF";
    assert(
      httpOk || httpFlatTraced,
      "B) GeoTIFF HTTP consommé (SURFACE_DSM+HTTP_GEOTIFF ou fallback masque plat traçable)",
      JSON.stringify({ source: r.source, prov: r.dataCoverage?.provider, meta: r.meta })
    );
    assert(Array.isArray(r.mask) && r.mask.length >= 10, "B) masque non vide");
    if (httpOk) {
      const maxElev = Math.max(...r.mask.map((m) => m.elev ?? 0));
      assert(maxElev > 0.1, "B) masque horizon non plat", String(maxElev));
      assert(
        r.meta?.providerType === "HTTP_GEOTIFF" || r.meta?.dataProduct === "HTTP_GEOTIFF_DSM",
        "B) meta traçable HTTP_GEOTIFF",
        JSON.stringify(r.meta)
      );
    }
  } finally {
    nock.cleanAll();
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  }
}

async function testC_http404TracedFallback() {
  const baseUrl = "https://geotiff-404-trace.test";
  const { x, y, z, lat, lon } = tileXYForParisZ15();
  const urlTemplate = `${baseUrl}/{z}/{x}/{y}.tif`;

  const prev = { ...process.env };
  try {
    process.env.HORIZON_DSM_ENABLED = "true";
    process.env.DSM_ENABLE = "true";
    process.env.DSM_PROVIDER_TYPE = "HTTP_GEOTIFF";
    process.env.DSM_GEOTIFF_URL_TEMPLATE = urlTemplate;
    process.env.DSM_REQUEST_TIMEOUT_MS = "3000";

    nock(baseUrl).get(`/${z}/${x}/${y}.tif`).reply(404, "not found");

    const { computeMask } = await import("../services/horizon/providers/surfaceDsmProvider.js");
    const r = await computeMask({
      lat,
      lon,
      radius_m: 500,
      step_deg: 2,
      organizationId: "test-c404",
    });

    assert(r.source === "RELIEF_ONLY", "C) 404 → RELIEF_ONLY");
    assert(r.meta?.fallbackReason === "HTTP_GEOTIFF_FAILED", "C) fallbackReason après 404");
  } finally {
    nock.cleanAll();
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  }
}

async function main() {
  console.log("\n--- http-geotiff-priority-and-fallback ---\n");
  await testA_connectionRefusedTracedFallback();
  await testB_successHttpGeotiffSelected();
  await testC_http404TracedFallback();

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
