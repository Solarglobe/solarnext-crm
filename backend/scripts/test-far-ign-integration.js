/**
 * CP-FAR-IGN-03 — Tests d'intégration far shading IGN RGE ALTI.
 * Scénarios: A) RELIEF_ONLY, B) IGN GRID + cache/suffix, C) IGN HD.
 * Exit 0 si tout PASS, sinon exit 1. Pas de rapport avant PASS.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { getOrComputeHorizonMask, getDsmSuffix, tileKey } from "../services/horizon/horizonMaskCache.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";
import { getIgnDsmDataDir } from "../services/horizon/providers/ign/ignRgeAltiConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAT = 48.8566;
const LON = 2.3522;
const RADIUS_M = 500;
const STEP_DEG = 2;
const TILE_DEG = 0.01;

async function ensureIndexBboxes() {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("FAIL: index.json absent. Exécuter: npm run build-ign-index-bboxes");
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (index.tiles && index.tiles.length > 0 && index.tiles[0].bboxLambert93) return index;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "build-ign-index-bboxes.js")], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-ign-index-bboxes exit ${code}: ${err}`));
    });
  });
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

async function main() {
  const failures = [];

  // --- A) RELIEF_ONLY ---
  const envRelief = { ...process.env };
  envRelief.HORIZON_DSM_ENABLED = "false";
  envRelief.DSM_ENABLE = "false";
  delete envRelief.DSM_PROVIDER_TYPE;

  const origEnv = { ...process.env };
  Object.assign(process.env, envRelief);

  try {
    const resultA = await computeHorizonMaskAuto({
      lat: LAT,
      lon: LON,
      radius_m: RADIUS_M,
      step_deg: STEP_DEG,
      enableHD: false,
    });
    assert(resultA.source === "RELIEF_ONLY", `A: source attendu RELIEF_ONLY, obtenu ${resultA.source}`);
    assert(
      (resultA.dataCoverage?.provider ?? resultA.source) === "RELIEF_ONLY" || resultA.source === "RELIEF_ONLY",
      "A: provider attendu RELIEF_ONLY"
    );
    console.log("RELIEF_ONLY OK");
  } catch (e) {
    failures.push("A: " + (e?.message || e));
  } finally {
    Object.assign(process.env, origEnv);
  }

  // --- B) IGN GRID (index requis) ---
  await ensureIndexBboxes();

  process.env.HORIZON_DSM_ENABLED = "true";
  process.env.DSM_ENABLE = "true";
  process.env.DSM_PROVIDER_TYPE = "IGN_RGE_ALTI";

  const suffix = getDsmSuffix();
  assert(suffix === ":dsm=ign", `B: suffix cache attendu ":dsm=ign", obtenu "${suffix}"`);

  const paramsB = {
    tenantKey: "test",
    lat: LAT,
    lon: LON,
    radius_m: RADIUS_M,
    step_deg: STEP_DEG,
    enableHD: false,
  };

  const run1 = await getOrComputeHorizonMask(paramsB, () =>
    computeHorizonMaskAuto({
      lat: paramsB.lat,
      lon: paramsB.lon,
      radius_m: paramsB.radius_m,
      step_deg: paramsB.step_deg,
      enableHD: false,
    })
  );
  assert(run1.cached === false, "B: run1 doit être cached=false");
  const value1 = run1.value;
  assert(value1.source === "SURFACE_DSM", `B: source attendu SURFACE_DSM, obtenu ${value1.source}`);
  assert(
    value1.dataCoverage?.provider === "IGN_RGE_ALTI",
    `B: dataCoverage.provider attendu IGN_RGE_ALTI, obtenu ${value1.dataCoverage?.provider}`
  );
  const expectedLen = Math.round(360 / STEP_DEG);
  assert(
    value1.mask?.length === expectedLen,
    `B: mask.length attendu ${expectedLen}, obtenu ${value1.mask?.length}`
  );
  const maxElevB = Math.max(...(value1.mask || []).map((m) => m.elev ?? 0));
  assert(maxElevB > 0.1, `B: maxElev attendu > 0.1, obtenu ${maxElevB}`);

  const run2 = await getOrComputeHorizonMask(paramsB, () =>
    computeHorizonMaskAuto({
      lat: paramsB.lat,
      lon: paramsB.lon,
      radius_m: paramsB.radius_m,
      step_deg: paramsB.step_deg,
      enableHD: false,
    })
  );
  assert(run2.cached === true, "B: run2 doit être cached=true");

  const keyB = tileKey(paramsB.lat, paramsB.lon, paramsB.radius_m, paramsB.step_deg, TILE_DEG, paramsB.tenantKey ?? "public", false);
  assert(keyB.includes(":dsm=ign"), `B: clé cache doit contenir ":dsm=ign", obtenu ${keyB}`);

  console.log("IGN GRID OK");

  // --- C) IGN HD ---
  const paramsC = {
    lat: LAT,
    lon: LON,
    radius_m: RADIUS_M,
    step_deg: STEP_DEG,
    enableHD: true,
  };

  const resultC = await computeHorizonMaskAuto(paramsC);
  assert(resultC.source === "SURFACE_DSM", `C: source attendu SURFACE_DSM, obtenu ${resultC.source}`);
  assert(
    resultC.dataCoverage?.provider === "IGN_RGE_ALTI",
    `C: dataCoverage.provider attendu IGN_RGE_ALTI, obtenu ${resultC.dataCoverage?.provider}`
  );
  const algo = resultC.meta?.algorithm;
  const isHd = algo === "RAYCAST_HD";
  const isGridFallback = algo === "GRID";
  assert(
    isHd || isGridFallback,
    `C: meta.algorithm attendu RAYCAST_HD ou GRID (fallback), obtenu ${algo}`
  );
  const maxElevC = Math.max(...(resultC.mask || []).map((m) => m.elev ?? 0));
  assert(maxElevC > 0.1, `C: mask non plat (maxElev > 0.1), obtenu ${maxElevC}`);

  console.log("IGN HD OK");

  if (failures.length > 0) {
    console.error("FAIL:", failures.join("; "));
    process.exit(1);
  }

  console.log("");
  console.log("CP-FAR-IGN-03 PASS");
  console.log("RELIEF_ONLY OK");
  console.log("IGN GRID OK");
  console.log("IGN HD OK");
  console.log("VERDICT: 🟢 PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
