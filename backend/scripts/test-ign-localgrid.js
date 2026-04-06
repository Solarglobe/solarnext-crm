/**
 * CP-FAR-IGN-02 — Test CLI grille locale IGN (Paris, radius 500 m, res 10 m).
 * Construit l'index bbox si absent, crée sampler + local grid, vérifie ratio/variance.
 * Sortie PASS unique. exit(0) si PASS sinon exit(1).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { getIgnDsmDataDir } from "../services/horizon/providers/ign/ignRgeAltiConfig.js";
import { wgs84ToLambert93 } from "../services/horizon/providers/ign/projection2154.js";
import { selectTilesForRadius } from "../services/horizon/providers/ign/selectTilesForRadius.js";
import { createIgnTileLoader } from "../services/horizon/providers/ign/ignTileLoader.js";
import { createIgnHeightSampler } from "../services/horizon/providers/ign/heightSampler2154.js";
import { buildLocalGrid2154 } from "../services/horizon/providers/ign/buildLocalGrid2154.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LAT = 48.8566;
const LON = 2.3522;
const RADIUS_M = 500;
const DESIRED_RES_M = 10;
const MIN_VALID_RATIO = 0.8;
const MIN_VARIANCE = 1e-6;

async function ensureIndexBboxes() {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error("FAIL: index.json absent. Exécuter: node scripts/download-ign-rgealti-d075.js");
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

function variance(arr, noDataValue) {
  const valid = arr.filter((v) => v !== noDataValue && v === v);
  if (valid.length === 0) return 0;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length;
}

async function main() {
  const index = await ensureIndexBboxes();
  const center = wgs84ToLambert93({ lat: LAT, lon: LON });
  const selected = selectTilesForRadius(center, RADIUS_M, index);

  const tileLoader = createIgnTileLoader();
  const sampler = createIgnHeightSampler({ tilesIndex: { tiles: selected }, tileLoader });
  const localGrid = await buildLocalGrid2154(
    { centerX: center.x, centerY: center.y, radius_m: RADIUS_M, desiredRes_m: DESIRED_RES_M },
    sampler
  );

  const { grid, width, height, noDataValue } = localGrid;
  if (!grid || grid.length === 0) {
    console.error("FAIL: grid vide");
    process.exit(1);
  }

  const validCount = Array.from(grid).filter((v) => v !== noDataValue && !Number.isNaN(v)).length;
  const total = width * height;
  const validRatio = total > 0 ? validCount / total : 0;

  if (validRatio < MIN_VALID_RATIO) {
    console.error("FAIL: ratio valeurs valides < 0.8:", validRatio.toFixed(2));
    process.exit(1);
  }

  const validAlt = Array.from(grid).filter((v) => v !== noDataValue && !Number.isNaN(v));
  const varAlt = variance(validAlt, noDataValue);
  if (varAlt < MIN_VARIANCE) {
    console.error("FAIL: variance ~ 0");
    process.exit(1);
  }

  const minAlt = Math.min(...validAlt);
  const maxAlt = Math.max(...validAlt);
  if (minAlt < -50 || maxAlt > 500) {
    console.warn("Warning: min/max altitude hors plage raisonnable:", minAlt, maxAlt);
  }

  console.log("IGN LOCALGRID READY");
  console.log("TILES USED: " + selected.length);
  console.log("VALID RATIO: " + validRatio.toFixed(4));
  console.log("VARIANCE OK");
  console.log("VERDICT: 🟢 PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
