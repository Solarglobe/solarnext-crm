/**
 * CP-FAR-IGN-01 — Téléchargement réel RGE ALTI D075 via API data.geopf.fr.
 * Télécharge le .7z officiel, extrait vers extract/, garde les .asc + index JSON.
 * Pas de conversion GeoTIFF WGS84.
 *
 * URLs utilisées (API Géoplateforme) :
 * - Download: https://data.geopf.fr/telechargement/download/{resourceName}/{subResourceName}/{fileName}
 * Obtenus programmatiquement depuis le catalogue (RGE ALTI D075 Paris).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import fetch from "node-fetch";
import { path7za } from "7zip-bin";
import {
  getIgnDsmDataDir,
  GEOPF_DOWNLOAD_BASE,
  IGN_RGEALTI_SUBRESOURCE_NAME,
} from "../services/horizon/providers/ign/ignRgeAltiConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RESOURCE_NAME = "RGEALTI";
const SUBRESOURCE_NAME = IGN_RGEALTI_SUBRESOURCE_NAME;
const FILE_NAME = SUBRESOURCE_NAME + ".7z";

function get7zPath() {
  if (process.env.USE_SYSTEM_7Z === "true") {
    if (process.platform === "win32") {
      const p = path.join(process.env["ProgramFiles"] || "C:\\Program Files", "7-Zip", "7z.exe");
      if (fs.existsSync(p)) return p;
      return "7z";
    }
    return "7z";
  }
  return path7za;
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { redirect: "follow", headers: { Accept: "application/octet-stream" } });
  if (!res.ok) throw new Error(`Téléchargement ${res.status}: ${url}`);
  const ab = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(ab));
  return destPath;
}

function extract7z(archivePath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const sevenZ = get7zPath();
  execSync(`"${sevenZ}" x "${archivePath}" -o"${outDir}" -y`, { stdio: "inherit", maxBuffer: 50 * 1024 * 1024 });
}

function findAscFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findAscFiles(full, acc);
    else if (e.name.toLowerCase().endsWith(".asc")) acc.push(full);
  }
  return acc;
}

async function main() {
  const dataDir = getIgnDsmDataDir();
  const rawDir = path.join(dataDir, "raw");
  const extractDir = path.join(dataDir, "extract");

  const downloadUrl = `${GEOPF_DOWNLOAD_BASE}/download/${RESOURCE_NAME}/${SUBRESOURCE_NAME}/${FILE_NAME}`;
  const archivePath = path.join(rawDir, FILE_NAME);

  console.log("Téléchargement:", downloadUrl);
  await downloadToFile(downloadUrl, archivePath);
  const sizeMb = (fs.statSync(archivePath).size / (1024 * 1024)).toFixed(2);
  console.log("Téléchargé:", archivePath, `(${sizeMb} MB)`);

  console.log("Extraction 7z...");
  extract7z(archivePath, extractDir);

  const ascFiles = findAscFiles(extractDir);
  const index = {
    resourceName: RESOURCE_NAME,
    subResourceName: SUBRESOURCE_NAME,
    fileName: FILE_NAME,
    downloadUrl,
    sizeBytes: fs.statSync(archivePath).size,
    extractedAt: new Date().toISOString(),
    ascFiles: ascFiles.map((f) => path.relative(dataDir, f)),
  };
  const indexPath = path.join(dataDir, "index.json");
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  console.log("Fichiers .asc trouvés:", ascFiles.length);
  console.log("Index:", indexPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
