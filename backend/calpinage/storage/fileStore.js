// ======================================================================
// Stockage Calpinage — 1 fichier JSON par lead (temporaire, remplaçable)
// ======================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.join(__dirname, "data");

function ensureDir() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
}

export function getFilePath(leadId) {
  ensureDir();
  return path.join(BASE_DIR, `calpinage_${leadId}.json`);
}

export function loadCalpinage(leadId) {
  const p = getFilePath(leadId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveCalpinage(leadId, data) {
  const p = getFilePath(leadId);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

export function deleteCalpinage(leadId) {
  const p = getFilePath(leadId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
