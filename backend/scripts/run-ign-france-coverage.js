/**
 * Couverture IGN France — grille, téléchargement optionnel, rapport JSON, verdict PASS/FAIL.
 * Ne modifie pas computeHorizonMaskAuto, horizonProviderSelector, ni JSON shading.
 */

process.env.HORIZON_DSM_ENABLED = "true";
process.env.DSM_ENABLE = "true";
process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_STEP_DEG = 0.5;
const DEFAULT_RADIUS_M = 500;
const DEFAULT_STEP_AZ_DEG = 2;
const DEFAULT_MAX_POINTS = 2000;
const DEFAULT_PASS_PCT = 98;
const DEFAULT_FALLBACK_MAX_PCT = 5;
const FRANCE_LAT_MIN = 41.0;
const FRANCE_LAT_MAX = 51.5;
const FRANCE_LON_MIN = -5.5;
const FRANCE_LON_MAX = 9.5;
const MIN_RANGE_DEG = 0.5;
const MIN_STD_DEV_DEG = 0.2;
const MAX_SAMPLES_PER_CATEGORY = 50;

function getStepDeg() {
  const v = process.env.IGN_COVERAGE_STEP_DEG;
  return v != null && v !== "" ? Math.max(0.1, parseFloat(v)) : DEFAULT_STEP_DEG;
}

function getRadiusM() {
  const v = process.env.IGN_COVERAGE_RADIUS_M;
  return v != null && v !== "" ? Math.max(100, parseInt(v, 10)) : DEFAULT_RADIUS_M;
}

function getStepAzDeg() {
  const v = process.env.IGN_COVERAGE_STEP_AZ_DEG;
  return v != null && v !== "" ? Math.max(0.5, parseFloat(v)) : DEFAULT_STEP_AZ_DEG;
}

function getMaxPoints() {
  const v = process.env.IGN_COVERAGE_MAX_POINTS;
  return v != null && v !== "" ? Math.max(1, parseInt(v, 10)) : DEFAULT_MAX_POINTS;
}

function getDownloadEnabled() {
  const downloadMode = (process.env.IGN_DOWNLOAD_MODE || "OFF").toUpperCase();
  const explicit = process.env.IGN_COVERAGE_DOWNLOAD_ENABLED;
  if (explicit === "false" || explicit === "0") return false;
  return downloadMode !== "OFF";
}

function getPassPct() {
  const v = process.env.IGN_COVERAGE_PASS_PCT;
  return v != null && v !== "" ? parseFloat(v) : DEFAULT_PASS_PCT;
}

function getFallbackMaxPct() {
  const v = process.env.IGN_COVERAGE_FALLBACK_MAX_PCT;
  return v != null && v !== "" ? parseFloat(v) : DEFAULT_FALLBACK_MAX_PCT;
}

function parseBboxEnv() {
  const raw = process.env.IGN_COVERAGE_BBOX;
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { latMin: parts[0], latMax: parts[1], lonMin: parts[2], lonMax: parts[3] };
}

function buildGrid(bbox, stepDeg, maxPoints) {
  const { latMin, latMax, lonMin, lonMax } = bbox;
  let step = stepDeg;
  let points = [];
  for (;;) {
    points = [];
    for (let lat = latMin; lat <= latMax; lat += step) {
      for (let lon = lonMin; lon <= lonMax; lon += step) {
        points.push({
          lat: Math.round(lat * 1000) / 1000,
          lon: Math.round(lon * 1000) / 1000,
        });
      }
    }
    if (points.length <= maxPoints) break;
    step *= 1.5;
    if (step > 10) {
      step = 10;
      points = points.slice(0, maxPoints);
      console.warn("[IGN COVERAGE] Grille plafonnée à", maxPoints, "points (step max 10°)");
      break;
    }
    console.warn("[IGN COVERAGE] Réduction step à", step.toFixed(2), "° (points", points.length, ">", maxPoints, ")");
  }
  return points;
}

function elevationStats(mask) {
  if (!mask || mask.length === 0) return { min: 0, max: 0, stdDev: 0, range: 0 };
  const elevs = mask.map((m) => Number(m?.elev ?? 0)).filter(Number.isFinite);
  if (elevs.length === 0) return { min: 0, max: 0, stdDev: 0, range: 0 };
  const min = Math.min(...elevs);
  const max = Math.max(...elevs);
  const mean = elevs.reduce((a, b) => a + b, 0) / elevs.length;
  const variance = elevs.reduce((a, b) => a + (b - mean) ** 2, 0) / elevs.length;
  const stdDev = Math.sqrt(variance);
  return { min, max, stdDev, range: max - min };
}

function ensureReportsDir() {
  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

async function main() {
  const bboxOverride = parseBboxEnv();
  const bbox = bboxOverride ?? {
    latMin: FRANCE_LAT_MIN,
    latMax: FRANCE_LAT_MAX,
    lonMin: FRANCE_LON_MIN,
    lonMax: FRANCE_LON_MAX,
  };

  const stepDeg = getStepDeg();
  const maxPoints = getMaxPoints();
  const grid = buildGrid(bbox, stepDeg, maxPoints);
  const radius_m = getRadiusM();
  const step_deg = getStepAzDeg();
  const downloadEnabled = getDownloadEnabled();
  const passPct = getPassPct();
  const fallbackMaxPct = getFallbackMaxPct();

  const downloadMode = (process.env.IGN_DOWNLOAD_MODE || "OFF").toUpperCase();
  const lockMode = (process.env.IGN_LOCK_MODE || "LOCAL").toUpperCase();
  const sharedCacheRoot = process.env.IGN_SHARED_CACHE_ROOT ?? null;

  const { ensureIgnTileAvailable } = await import("../services/dsmDynamic/ignDynamicLoader.js");
  const { computeHorizonMaskAuto } = await import("../services/horizon/providers/horizonProviderSelector.js");

  let ignOk = 0;
  let fallback = 0;
  let errors = 0;
  let flatSuspect = 0;
  const fallbackPoints = [];
  const errorPoints = [];
  const flatPoints = [];
  const total = grid.length;

  console.log("[IGN COVERAGE] Grille France — points:", total, "step:", stepDeg, "° download:", downloadEnabled);

  for (let i = 0; i < grid.length; i++) {
    const point = grid[i];
    try {
      if (downloadEnabled) {
        await ensureIgnTileAvailable(point.lat, point.lon);
      }

      const result = await computeHorizonMaskAuto({
        lat: point.lat,
        lon: point.lon,
        radius_m,
        step_deg,
        enableHD: false,
      });

      const farSource = result.meta?.farSource ?? result.dataCoverage?.provider ?? result.source;
      const isIgnOk = farSource === "IGN_RGE_ALTI" && !result.meta?.fallbackReason;

      if (!isIgnOk) {
        fallback++;
        if (fallbackPoints.length < MAX_SAMPLES_PER_CATEGORY) {
          fallbackPoints.push({
            lat: point.lat,
            lon: point.lon,
            reason: result.meta?.fallbackReason ?? "IGN_UNAVAILABLE",
          });
        }
        if ((i + 1) % 100 === 0) process.stdout.write(`\r  ${i + 1}/${total}`);
        continue;
      }

      const stats = elevationStats(result.mask);
      const flat = stats.range < MIN_RANGE_DEG || stats.stdDev < MIN_STD_DEV_DEG;
      if (flat) {
        flatSuspect++;
        if (flatPoints.length < MAX_SAMPLES_PER_CATEGORY) {
          flatPoints.push({
            lat: point.lat,
            lon: point.lon,
            range: Math.round(stats.range * 1000) / 1000,
            stdDev: Math.round(stats.stdDev * 1000) / 1000,
          });
        }
      } else {
        ignOk++;
      }
    } catch (err) {
      errors++;
      if (errorPoints.length < MAX_SAMPLES_PER_CATEGORY) {
        errorPoints.push({
          lat: point.lat,
          lon: point.lon,
          error: (err && err.message) || String(err),
        });
      }
    }
    if ((i + 1) % 100 === 0) process.stdout.write(`\r  ${i + 1}/${total}`);
  }

  process.stdout.write(`\r  ${total}/${total}\n`);

  const coveragePct = total > 0 ? Math.round((ignOk / total) * 10000) / 100 : 0;
  const fallbackPct = total > 0 ? Math.round((fallback / total) * 10000) / 100 : 0;

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      stepDeg,
      pointsTested: total,
      downloadMode,
      lockMode,
      sharedCacheRoot,
    },
    summary: {
      ignOk,
      fallback,
      errors,
      flatSuspect,
      coveragePct,
      fallbackPct,
    },
    samples: {
      fallbackPoints,
      errorPoints,
      flatPoints,
    },
  };

  const reportsDir = ensureReportsDir();
  const now = new Date();
  const timestamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const reportPath = path.join(reportsDir, `ign-coverage-france-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log("[IGN COVERAGE] Rapport écrit:", reportPath);

  const pass =
    coveragePct >= passPct &&
    fallbackPct <= fallbackMaxPct &&
    errors === 0;

  console.log("");
  console.log("--- RÉSUMÉ ---");
  console.log("IGN OK:", ignOk, "| Fallback:", fallback, "| Erreurs:", errors, "| Flat suspect:", flatSuspect);
  console.log("Couverture:", coveragePct + "%", "| Fallback:", fallbackPct + "%");
  console.log("Verdict:", pass ? "PASS" : "FAIL");

  process.exit(pass ? 0 : 2);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(2);
});
