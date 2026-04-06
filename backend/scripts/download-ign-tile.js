/**
 * CP-FAR-IGN-01 — Téléchargement automatisé d'une tuile RGE ALTI (IGN Open Data)
 * Utilise l'URL officielle IGN / Géoplateforme (pas d'URL en dur).
 * Usage: node backend/scripts/download-ign-tile.js <lat> <lon>
 * Exemple: node backend/scripts/download-ign-tile.js 48.8566 2.3522
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import fetch from "node-fetch";
import { writeArrayBuffer } from "geotiff";
import { IGN_RGEALTI_BASE_URL, IGN_RGEALTI_CATALOG_URL, getIgnDsmDataDir } from "../services/horizon/providers/ignRgeAltiConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Code département depuis lat/lon (approximation France métropolitaine) */
function latLonToDepartment(lat, lon) {
  const depts = [
    { code: "075", name: "Paris", latMin: 48.81, latMax: 48.92, lonMin: 2.22, lonMax: 2.47 },
    { code: "093", name: "Seine-Saint-Denis", latMin: 48.89, latMax: 49.09, lonMin: 2.33, lonMax: 2.66 },
    { code: "094", name: "Val-de-Marne", latMin: 48.69, latMax: 48.86, lonMin: 2.31, lonMax: 2.60 },
    { code: "092", name: "Hauts-de-Seine", latMin: 48.76, latMax: 48.97, lonMin: 2.16, lonMax: 2.35 },
    { code: "078", name: "Yvelines", latMin: 48.52, latMax: 49.05, lonMin: 1.49, lonMax: 2.24 },
    { code: "091", name: "Essonne", latMin: 48.33, latMax: 48.69, lonMin: 2.09, lonMax: 2.50 },
    { code: "077", name: "Seine-et-Marne", latMin: 48.14, latMax: 49.22, lonMin: 2.52, lonMax: 3.56 },
    { code: "095", name: "Val-d'Oise", latMin: 48.95, latMax: 49.22, lonMin: 1.62, lonMax: 2.67 },
  ];
  for (const d of depts) {
    if (lat >= d.latMin && lat <= d.latMax && lon >= d.lonMin && lon <= d.lonMax) return d.code;
  }
  return "075";
}

/**
 * Noms de ressources officiels IGN (schéma documenté sur geoservices.ign.fr/telechargement-api/RGEALTI).
 * Format: RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D{CODE}_{DATE}
 * Complété depuis le catalogue quand le parsing HTML ne renvoie pas la liste (page dynamique).
 */
const FALLBACK_RESOURCES = {
  "075": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D075_2020-07-30",
  "093": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D093_2022-06-16",
  "094": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D094_2022-06-16",
  "092": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D092_2022-06-16",
  "078": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D078_2021-09-24",
  "091": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D091_2022-06-16",
  "077": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D077_2021-09-24",
  "095": "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D095_2022-06-16",
};

/** Récupère l'URL de téléchargement officielle pour un département (catalogue IGN ou schéma documenté) */
async function getDownloadUrlForDepartment(deptCode) {
  const catalogUrl = IGN_RGEALTI_CATALOG_URL;
  try {
    const res = await fetch(catalogUrl, { headers: { Accept: "text/html" } });
    if (res.ok) {
      const html = await res.text();
      const resourcePattern = new RegExp(
        `RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D${deptCode}_([\\d-]+)`,
        "gi"
      );
      const resourceNames = [];
      let m;
      while ((m = resourcePattern.exec(html)) !== null) {
        const name = m[0];
        if (!resourceNames.includes(name)) resourceNames.push(name);
      }
      if (resourceNames.length > 0) {
        resourceNames.sort((a, b) => b.localeCompare(a));
        const resourceName = resourceNames[0];
        return `${IGN_RGEALTI_BASE_URL}/${resourceName}/${resourceName}.7z`;
      }
    }
  } catch (_) {}
  const resourceName = FALLBACK_RESOURCES[deptCode];
  if (resourceName) {
    return `${IGN_RGEALTI_BASE_URL}/${resourceName}/${resourceName}.7z`;
  }
  throw new Error(`Aucune ressource RGE ALTI trouvée pour le département ${deptCode}. Consulter ${catalogUrl}`);
}

/** Télécharge un fichier vers un chemin local */
async function downloadToFile(url, destPath) {
  const res = await fetch(url, { redirect: "follow", headers: { Accept: "application/octet-stream" } });
  if (!res.ok) throw new Error(`Téléchargement ${res.status}: ${url}`);
  const ab = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(ab));
  return destPath;
}

/** Retourne le chemin de l'exécutable 7z (Windows: 7-Zip, sinon PATH) */
function get7zPath() {
  if (process.platform !== "win32") return "7z";
  const candidates = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "7-Zip", "7z.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "7-Zip", "7z.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "7z";
}

/** Extrait un .7z avec 7z (doit être dans PATH ou 7-Zip installé sous Windows) */
function extract7z(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const sevenZ = get7zPath();
  try {
    execSync(`"${sevenZ}" x "${archivePath}" -o"${outDir}" -y`, { stdio: "inherit" });
  } catch (e) {
    throw new Error(
      "Extraction 7z échouée. Installez 7-Zip (https://www.7-zip.org/) et assurez-vous que 7z est dans PATH ou dans Program Files."
    );
  }
}

/** Lambert 93 (EPSG:2154) -> WGS84 (EPSG:4326), formule approchée (sans proj4) */
function lambert93ToWgs84(x, y) {
  const a = 6378137;
  const e = 0.08181919104;
  const lc = (x - 700000) / (a * (1 - (e * e) / 4 - (3 * e * e * e * e) / 64));
  const phi1 = lc + ((3 * e) / 2 - (27 * e * e * e) / 32) * Math.sin(2 * lc);
  const n = a / Math.sqrt(1 - e * e * Math.sin(phi1) * Math.sin(phi1));
  const latRad = phi1 - ((n * Math.tan(phi1)) / (a * a)) * (((y - 6600000) * (y - 6600000)) / 2);
  const lonRad = 3 * (Math.PI / 180) + (1 / (n * Math.cos(phi1))) * (x - 700000);
  return { lon: (lonRad * 180) / Math.PI, lat: (latRad * 180) / Math.PI };
}

/** Trouve un fichier .asc dans un répertoire (récursif) */
function findFirstAsc(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findFirstAsc(full);
      if (found) return found;
    } else if (e.name.toLowerCase().endsWith(".asc")) return full;
  }
  return null;
}

/** Parse un fichier ASC (Esri ASCII Raster) */
function parseAsc(ascPath) {
  const content = fs.readFileSync(ascPath, "utf8");
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  let ncols = 0,
    nrows = 0,
    xllcorner = 0,
    yllcorner = 0,
    cellsize = 1,
    nodata = -9999;
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("ncols")) ncols = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith("nrows")) nrows = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith("xllcorner")) xllcorner = parseFloat(line.split(/\s+/)[1]);
    else if (line.startsWith("yllcorner")) yllcorner = parseFloat(line.split(/\s+/)[1]);
    else if (line.startsWith("cellsize")) cellsize = parseFloat(line.split(/\s+/)[1]);
    else if (line.startsWith("NODATA") || line.startsWith("nodata")) nodata = parseFloat(line.split(/\s+/)[1]);
    else if (line.length > 0 && /^-?\d|\.\d/.test(line)) {
      dataStart = i;
      break;
    }
  }
  const grid = new Float32Array(ncols * nrows);
  let idx = 0;
  for (let i = dataStart; i < lines.length && idx < ncols * nrows; i++) {
    const parts = lines[i].split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const v = parseFloat(p);
      grid[idx++] = v === nodata || isNaN(v) ? NaN : v;
    }
  }
  return { ncols, nrows, xllcorner, yllcorner, cellsize, nodata, grid };
}

/** Écrit une grille ASC (Lambert 93) en GeoTIFF WGS84 */
function writeGeoTiffFromAsc(ascData, outPath) {
  const { ncols, nrows, xllcorner, yllcorner, cellsize, grid } = ascData;
  const xNW = xllcorner;
  const yNW = yllcorner + nrows * cellsize;
  const { lon: lonNW, lat: latNW } = lambert93ToWgs84(xNW, yNW);
  const M_PER_DEG_LAT = 111320;
  const latRad = (latNW * Math.PI) / 180;
  const dLat = cellsize / M_PER_DEG_LAT;
  const dLon = cellsize / (M_PER_DEG_LAT * Math.cos(latRad));
  const metadata = {
    width: ncols,
    height: nrows,
    GeographicTypeGeoKey: 4326,
    ModelPixelScale: [dLon, -dLat, 0],
    ModelTiepoint: [0, 0, 0, lonNW, latNW, 0],
  };
  const arrayBuffer = writeArrayBuffer(Array.from(grid), metadata);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
}

async function main() {
  const lat = parseFloat(process.argv[2] || "48.8566");
  const lon = parseFloat(process.argv[3] || "2.3522");
  const dept = latLonToDepartment(lat, lon);
  const dataDir = getIgnDsmDataDir();
  const tifPath = path.join(dataDir, `D${dept}.tif`);

  if (fs.existsSync(tifPath)) {
    console.log("Tuile déjà présente:", tifPath);
    process.exit(0);
    return;
  }

  console.log("Résolution URL officielle IGN pour département", dept, "...");
  const downloadUrl = await getDownloadUrlForDepartment(dept);
  console.log("Téléchargement:", downloadUrl);

  const archivePath = path.join(dataDir, `RGEALTI_D${dept}.7z`);
  await downloadToFile(downloadUrl, archivePath);
  console.log("Téléchargé:", archivePath);

  const extractDir = path.join(dataDir, "extract");
  extract7z(archivePath, extractDir);
  const ascPath = findFirstAsc(extractDir);
  if (!ascPath) throw new Error("Aucun fichier .asc trouvé dans l'archive");
  console.log("ASC trouvé:", ascPath);

  const ascData = parseAsc(ascPath);
  writeGeoTiffFromAsc(ascData, tifPath);
  console.log("GeoTIFF écrit:", tifPath);

  try {
    fs.unlinkSync(archivePath);
    fs.rmSync(extractDir, { recursive: true, force: true });
  } catch (_) {}
  console.log("OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
