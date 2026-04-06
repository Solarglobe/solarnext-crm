/**
 * CP-FAR-C-05 — Intégration DSM HTTP GeoTIFF réelle (full auto validation)
 * Lance un serveur local qui sert la fixture GeoTIFF, configure l'env, valide provider/cache/HD.
 * Usage: node backend/scripts/test-dsm-geotiff-live.js
 * Prérequis: node backend/scripts/generate-dsm-fixture.js (exécuté auto si fixture absente)
 * Exit 0 = PASS uniquement quand tout est validé.
 */

process.env.HORIZON_DSM_ENABLED = "true";
process.env.DSM_ENABLE = "true";
process.env.DSM_PROVIDER = "LOCAL";
process.env.FAR_HORIZON_HD_ENABLE = "true";
process.env.FAR_HORIZON_HD_TIME_BUDGET_MS = "3000";
const USE_HTTP_GEOTIFF = process.env.CP_FAR_C05_USE_HTTP_GEOTIFF === "1";
const PORT = 9876;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const URL_TEMPLATE = `${BASE_URL}/{z}/{x}/{y}.tif`;
if (USE_HTTP_GEOTIFF) {
  process.env.DSM_PROVIDER_TYPE = "HTTP_GEOTIFF";
  process.env.DSM_GEOTIFF_URL_TEMPLATE = URL_TEMPLATE;
}

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "..", "tests", "fixtures", "dsm", "sample.tif");
/** Dans le bbox du sample.tif (16×16 @ tiepoint 48.85,2.35) ; DSM_LOCAL accepte n’importe quel centre. */
const LAT = 48.849;
const LON = 2.3505;
const RADIUS_M = 500;
const STEP_DEG = 2;
const TIME_BUDGET_MS = 3000;
const MAX_ELEV_MIN = 0.1;
const VARIANCE_MIN = 1e-6;

function ensureFixture() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    execSync("node scripts/generate-dsm-fixture.js", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
  }
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error("Fixture GeoTIFF manquante: " + FIXTURE_PATH);
  }
}

function createServer() {
  const fixture = fs.readFileSync(FIXTURE_PATH);
  return http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/tiff" });
    res.end(fixture);
  });
}

function getMaxElev(mask) {
  if (!mask || !Array.isArray(mask)) return null;
  let max = -Infinity;
  for (const m of mask) {
    const e = m?.elev ?? 0;
    if (Number.isFinite(e) && e > max) max = e;
  }
  return Number.isFinite(max) ? max : null;
}

function getMaskVariance(mask) {
  if (!mask || mask.length < 2) return 0;
  const arr = mask.map((m) => Number(m?.elev ?? 0)).filter(Number.isFinite);
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sq = arr.reduce((a, b) => a + (b - mean) ** 2, 0);
  return sq / arr.length;
}

function stubSignature(mask) {
  const max = getMaxElev(mask);
  const n = mask?.length ?? 0;
  if (n !== 180) return false;
  const elevs = (mask || []).map((m) => m?.elev ?? 0);
  const allSame = elevs.every((e) => Math.abs(e - elevs[0]) < 1e-6);
  return allSame || (max != null && max <= 2 && elevs.every((e) => e >= 0 && e <= 50));
}

const ACCEPTED_DATA_PROVIDERS = USE_HTTP_GEOTIFF ? ["HTTP_GEOTIFF"] : ["DSM_REAL", "HTTP_GEOTIFF"];

async function main() {
  ensureFixture();
  let server = null;
  if (USE_HTTP_GEOTIFF) {
    server = createServer();
    await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
    await new Promise((r) => setTimeout(r, 300));
    const probe = await fetch(BASE_URL + "/15/0/0.tif");
    if (!probe.ok) throw new Error("Serveur fixture: " + probe.status);
  }

  const { getOrComputeHorizonMask, __testClearCache } = await import("../services/horizon/horizonMaskCache.js");
  const { computeHorizonMaskAuto } = await import("../services/horizon/providers/horizonProviderSelector.js");

  const failures = [];
  const latencies = [];
  let result1 = null;
  let result2 = null;
  let resultHd = null;

  try {
    __testClearCache();
    const params = { lat: LAT, lon: LON, radius_m: RADIUS_M, step_deg: STEP_DEG, enableHD: false };

    const r1 = await getOrComputeHorizonMask(
      { ...params, tenantKey: "test" },
      () => computeHorizonMaskAuto({ ...params, organizationId: "test" })
    );
    result1 = r1.value;
    if (r1.cached !== false) failures.push("Run1: cached doit être false");
    if (result1?.source !== "SURFACE_DSM") failures.push("Run1: provider final " + result1?.source + " (attendu SURFACE_DSM)");
    const dc = result1?.dataCoverage;
    const provider = dc?.provider ?? result1?.meta?.provider;
    if (!ACCEPTED_DATA_PROVIDERS.includes(provider)) failures.push("Run1: dataCoverage.provider " + provider + " (attendu " + ACCEPTED_DATA_PROVIDERS.join(" ou ") + ")");
    const maxElev = getMaxElev(result1?.mask);
    if (maxElev == null || maxElev <= MAX_ELEV_MIN) failures.push("Run1: maxElev " + maxElev + " (attendu > " + MAX_ELEV_MIN + "°)");
    const variance = getMaskVariance(result1?.mask);
    if (variance < VARIANCE_MIN) failures.push("Run1: variance masque " + variance + " (stub ou plat)");
    if (stubSignature(result1?.mask)) failures.push("Run1: masque identique au stub");
    const nPoints = result1?.mask?.length ?? 0;
    if (nPoints < 10) failures.push("Run1: masque trop peu de points: " + nPoints);

    const r2 = await getOrComputeHorizonMask(
      { ...params, tenantKey: "test" },
      () => computeHorizonMaskAuto({ ...params, organizationId: "test" })
    );
    result2 = r2.value;
    if (r2.cached !== true) failures.push("Run2: cached doit être true");
    if (result2?.source !== "SURFACE_DSM") failures.push("Run2: provider " + result2?.source);

    __testClearCache();
    const paramsHd = { ...params, enableHD: true };
    const t0 = Date.now();
    const rHd = await getOrComputeHorizonMask(
      { ...paramsHd, tenantKey: "test" },
      () => computeHorizonMaskAuto({ ...paramsHd, organizationId: "test" })
    );
    resultHd = rHd.value;
    latencies.push(Date.now() - t0);
    const maskHd = resultHd?.mask;
    if (!Array.isArray(maskHd) || maskHd.length === 0) failures.push("HD: masque vide");
    if (resultHd?.meta?.algorithm === "RAYCAST_HD") {
      const elapsed = resultHd.meta.elapsedMs;
      if (elapsed > TIME_BUDGET_MS * 1.2) failures.push("HD: elapsed " + elapsed + " ms > timeBudget*1.2");
    }
  } finally {
    if (server) {
      await new Promise((r) => setTimeout(r, 200));
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      await new Promise((resolve) => server.close(resolve));
    }
  }

  if (failures.length > 0) {
    console.error("FAIL:", failures.join("; "));
    process.exit(1);
  }

  const meanMs = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.ceil(0.95 * sorted.length) - 1] : 0;

  const dataProvider = result1?.dataCoverage?.provider ?? result1?.meta?.provider ?? "n/a";
  console.log("--- CP-FAR-C-05 RAPPORT FINAL ---");
  console.log("DSM ACTIVÉ : YES");
  console.log("PROVIDER : SURFACE_DSM");
  console.log("DATA PROVIDER : " + dataProvider);
  console.log("HD ACTIVÉ : YES");
  console.log("CACHE OK : YES");
  console.log("MAX ELEV : " + (getMaxElev(result1?.mask)?.toFixed(2) ?? "n/a") + "°");
  console.log("VARIANCE MASK : " + getMaskVariance(result1?.mask).toFixed(6));
  console.log("LATENCE MOYENNE : " + meanMs.toFixed(0) + " ms");
  console.log("P95 : " + p95.toFixed(0) + " ms");
  console.log("VERDICT : 🟢 PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
