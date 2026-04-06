/**
 * CP-FAR-IGN-01 — Provider DSM IGN RGE ALTI (Lambert-93 natif, zéro bidouille).
 * Données réelles via data.geopf.fr, cache local ASCII, pas de GeoTIFF WGS84.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { wgs84ToLambert93 } from "./ign/projection2154.js";
import { getIgnDsmDataDir } from "./ign/ignRgeAltiConfig.js";
import { parseEsriAsciiGrid, parseEsriAsciiGridHeader } from "./ign/parseEsriAsciiGrid.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG = process.env.DSM_DEBUG === "true" || process.env.FAR_DEBUG === "true";

function log(...args) {
  if (DEBUG) console.log("[DSM:IGN]", ...args);
}

async function ensureD075Downloaded() {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (index.ascFiles && index.ascFiles.length > 0) return;
  }

  log("Données D075 absentes, lancement du téléchargement...");
  const scriptPath = path.join(__dirname, "..", "..", "..", "scripts", "download-ign-rgealti-d075.js");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(__dirname, "..", "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`download-ign-rgealti-d075 exit ${code}: ${stderr}`));
    });
  });
}

/**
 * Charge la grille DSM IGN RGE ALTI pour un site (lat, lon) avec un rayon donné.
 * Lambert-93 natif, pas de conversion WGS84.
 *
 * @param {{ lat: number, lon: number, radius_m: number }} params
 * @returns {Promise<{
 *   source: string,
 *   crs: string,
 *   width: number,
 *   height: number,
 *   origin: { x0: number, y0: number },
 *   stepMeters: number,
 *   noDataValue: number,
 *   grid: Float32Array
 * }>}
 * @throws si le point est hors dalles disponibles
 */
export async function getIgnDsmGridForSite({ lat, lon, radius_m }) {
  const { x, y } = wgs84ToLambert93({ lat, lon });
  await ensureD075Downloaded();

  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    throw new Error("Données IGN D075 absentes après téléchargement (index.json manquant)");
  }

  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const ascFiles = (index.ascFiles || []).map((rel) => path.join(dataDir, rel));
  if (ascFiles.length === 0) {
    throw new Error("Aucun fichier .asc dans le cache IGN D075");
  }

  let chosenPath = null;
  for (const ascPath of ascFiles) {
    if (!fs.existsSync(ascPath)) continue;
    const header = parseEsriAsciiGridHeader(ascPath);
    const { x0, y0, x1, y1 } = header;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) {
      chosenPath = ascPath;
      break;
    }
  }

  if (!chosenPath) {
    throw new Error(
      `Point (${lat}, ${lon}) Lambert-93 (${x.toFixed(0)}, ${y.toFixed(0)}) hors des dalles disponibles (D075)`
    );
  }

  const parsed = parseEsriAsciiGrid(chosenPath);
  return {
    source: "IGN_RGE_ALTI",
    crs: "EPSG:2154",
    width: parsed.width,
    height: parsed.height,
    origin: { x0: parsed.x0, y0: parsed.y0 },
    stepMeters: parsed.cellsize_m,
    noDataValue: parsed.noDataValue,
    grid: parsed.grid,
  };
}
