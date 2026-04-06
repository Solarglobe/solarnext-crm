/**
 * CP-FAR-C-07 — Validation couverture IGN France complète (grille nationale).
 * Forçage ENV avant tout import horizon. Rebuild index si manquant. Boucle jusqu'à >98% couverture.
 * Read-only : ne modifie pas computeHorizonMaskAuto, provider, cache, ni JSON shading.
 */

// ——— ENV forcé AVANT tout import du module horizon ———
process.env.HORIZON_DSM_ENABLED = "true";
process.env.DSM_ENABLE = "true";
process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAT_MIN = 41.0;
const LAT_MAX = 51.5;
const LON_MIN = -5.5;
const LON_MAX = 9.5;
const STEP_LAT = 0.5;
const STEP_LON = 0.5;
const RADIUS_M = 500;
const STEP_DEG = 2;
const MIN_ELEVATION_SPAN_DEG = 0.5;
const MIN_STD_DEV_DEG = 0.2;
const COVERAGE_PASS_PCT = 98;
const FALLBACK_FAIL_PCT = 5;
const MAX_ATTEMPTS = 5;

function buildGrid() {
  const points = [];
  for (let lat = LAT_MIN; lat <= LAT_MAX; lat += STEP_LAT) {
    for (let lon = LON_MIN; lon <= LON_MAX; lon += STEP_LON) {
      points.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 });
    }
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

async function runBuildIgnIndexBboxes() {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build-ign-index-bboxes"], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-ign-index-bboxes exit ${code}: ${err || out}`));
    });
  });
}

async function ensureIndexBboxes(getIgnDsmDataDir) {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.log("Index IGN absent. Lancement: npm run build-ign-index-bboxes");
    try {
      await runBuildIgnIndexBboxes();
    } catch (e) {
      throw new Error(
        "Index IGN absent ou build échoué. Exécuter d'abord téléchargement RGE ALTI puis npm run build-ign-index-bboxes. " + (e?.message ?? "")
      );
    }
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const needsBbox = index.tiles && index.tiles.length > 0 && (!index.tiles[0].bboxLambert93);
  if (needsBbox) {
    console.log("Index sans bbox Lambert93. Rebuild: npm run build-ign-index-bboxes");
    await runBuildIgnIndexBboxes();
  }
  const indexFinal = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  if (!indexFinal.tiles || indexFinal.tiles.length === 0) {
    throw new Error("Index IGN vide. Vérifier données .asc (ex. download-ign-rgealti-d075).");
  }
}

async function runGridTest(computeHorizonMaskAuto) {
  const grid = buildGrid();
  const total = grid.length;
  let ignOk = 0;
  let fallbackCount = 0;
  let masquePlatCount = 0;
  let errorCount = 0;
  let ignUnavailableCount = 0;
  const fallbackPoints = [];
  const flatPoints = [];
  const errorPoints = [];
  let firstResultSource = null;

  for (let i = 0; i < grid.length; i++) {
    const point = grid[i];
    try {
      const result = await computeHorizonMaskAuto({
        lat: point.lat,
        lon: point.lon,
        radius_m: RADIUS_M,
        step_deg: STEP_DEG,
        enableHD: false,
      });
      const farSource = result.meta?.farSource ?? result.dataCoverage?.provider ?? result.source;
      if (firstResultSource === null) firstResultSource = farSource;
      const isFallback = farSource !== "IGN_RGE_ALTI" || result.meta?.fallbackReason;
      if (result.meta?.fallbackReason === "IGN_UNAVAILABLE") ignUnavailableCount++;
      const stats = elevationStats(result.mask);
      const flat = stats.range < MIN_ELEVATION_SPAN_DEG;
      const lowVariance = stats.stdDev < MIN_STD_DEV_DEG;
      if (isFallback) {
        fallbackCount++;
        fallbackPoints.push({ lat: point.lat, lon: point.lon });
      }
      if (flat || lowVariance) {
        masquePlatCount++;
        flatPoints.push({ lat: point.lat, lon: point.lon, range: stats.range, stdDev: stats.stdDev });
      }
      if (!isFallback && !flat && !lowVariance) ignOk++;
    } catch (err) {
      errorCount++;
      errorPoints.push({ lat: point.lat, lon: point.lon, msg: err?.message ?? String(err) });
    }
    if ((i + 1) % 100 === 0) console.log(`  Progression: ${i + 1}/${total}`);
  }

  const coveragePct = total > 0 ? Math.round((ignOk / total) * 10000) / 100 : 0;
  return {
    total,
    ignOk,
    fallbackCount,
    masquePlatCount,
    errorCount,
    coveragePct,
    ignUnavailableCount,
    fallbackPoints,
    flatPoints,
    errorPoints,
    firstResultSource,
  };
}

function printDiagnostic(result, attempt) {
  console.log("");
  console.log("--- DIAGNOSTIC (tentative " + attempt + ") ---");
  console.log("Provider réellement utilisé (1er point):", result.firstResultSource ?? "?");
  console.log("Fallback IGN_UNAVAILABLE (estimé):", result.ignUnavailableCount ?? "?");
  console.log("Erreurs tuiles:", result.errorCount);
  if (result.fallbackPoints.length > 0 && result.fallbackPoints.length <= 15) {
    console.log("Exemples fallback (lat, lon):", result.fallbackPoints.slice(0, 15).map((p) => `(${p.lat},${p.lon})`).join(" "));
  }
  console.log("");
}

async function main() {
  process.env.HORIZON_DSM_ENABLED = "true";
  process.env.DSM_ENABLE = "true";
  process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

  const { computeHorizonMaskAuto } = await import("../services/horizon/providers/horizonProviderSelector.js");
  const { getIgnDsmDataDir } = await import("../services/horizon/providers/ign/ignRgeAltiConfig.js");

  await ensureIndexBboxes(getIgnDsmDataDir);

  const grid = buildGrid();
  const total = grid.length;
  console.log("Grille France métropolitaine (bbox 41..51.5°N, -5.5..9.5°E, step 0.5°)");
  console.log("Points à tester:", total);
  console.log("");

  let lastResult = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastResult = await runGridTest(computeHorizonMaskAuto);
    const pass =
      lastResult.coveragePct > COVERAGE_PASS_PCT &&
      lastResult.fallbackCount < total * (FALLBACK_FAIL_PCT / 100) &&
      (lastResult.firstResultSource === "IGN_RGE_ALTI" || lastResult.ignOk > 0);

    if (pass) {
      console.log("");
      console.log("IGN Provider: IGN_RGE_ALTI");
      console.log("Points testés:", lastResult.total);
      console.log("IGN OK:", lastResult.ignOk);
      console.log("Fallback:", lastResult.fallbackCount);
      console.log("Masque plat:", lastResult.masquePlatCount);
      console.log("Erreurs:", lastResult.errorCount);
      console.log("Couverture IGN réelle:", lastResult.coveragePct + "%");
      console.log("STATUS: PASS");
      process.exit(0);
    }

    printDiagnostic(lastResult, attempt);
    if (attempt < MAX_ATTEMPTS) {
      process.env.HORIZON_DSM_ENABLED = "true";
      process.env.DSM_ENABLE = "true";
      process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";
      try {
        await runBuildIgnIndexBboxes();
      } catch (_) {
        // index peut déjà être bon
      }
      console.log("Nouvelle tentative", attempt + 1, "/", MAX_ATTEMPTS);
    }
  }

  console.log("");
  console.log("IGN Provider:", lastResult?.firstResultSource ?? "?");
  console.log("Points testés:", lastResult?.total ?? 0);
  console.log("IGN OK:", lastResult?.ignOk ?? 0);
  console.log("Fallback:", lastResult?.fallbackCount ?? 0);
  console.log("Masque plat:", lastResult?.masquePlatCount ?? 0);
  console.log("Erreurs:", lastResult?.errorCount ?? 0);
  console.log("Couverture IGN réelle:", (lastResult?.coveragePct ?? 0) + "%");
  console.log("STATUS: FAIL (couverture < 98% ou fallback > 5% après " + MAX_ATTEMPTS + " tentatives)");
  process.exit(1);
}

main().catch((err) => {
  console.error("Erreur:", err?.message ?? err);
  process.exit(1);
});
