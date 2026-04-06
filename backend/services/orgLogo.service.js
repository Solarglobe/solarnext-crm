/**
 * CP-ADMIN-ORG-04 — Service Logo Organisation
 * Stockage local : storage/org/{orgId}/logo.{ext}
 * Formats : png, jpg, svg — max 2MB
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "./localStorage.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORG_UPLOADS_ROOT = path.join(__dirname, "..", "storage", "org");
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_EXT = [".png", ".jpg", ".jpeg", ".svg"];
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];

function getExt(filename) {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

export function validateLogoFile(file) {
  if (!file || !file.buffer) throw new Error("Fichier manquant");
  if (file.size > MAX_SIZE) throw new Error("Fichier trop volumineux (max 2 Mo)");
  const ext = getExt(file.originalname || file.name || "");
  if (!ALLOWED_EXT.includes(ext)) throw new Error("Format non autorisé (png, jpg, svg)");
  if (file.mimetype && !ALLOWED_MIME.includes(file.mimetype)) {
    throw new Error("Type MIME non autorisé");
  }
  return ext;
}

/**
 * Sauvegarde le logo et retourne le chemin relatif pour logo_url
 * @param {Buffer} buffer
 * @param {string} orgId
 * @param {string} ext - .png, .jpg, .svg
 * @returns {string} - chemin relatif "org/{orgId}/logo.ext"
 */
export async function saveLogo(buffer, orgId, ext) {
  const dirPath = path.join(ORG_UPLOADS_ROOT, orgId);
  await fs.mkdir(dirPath, { recursive: true });
  const fileName = `logo${ext}`;
  const filePath = path.join(dirPath, fileName);
  await fs.writeFile(filePath, buffer);
  return `org/${orgId}/${fileName}`;
}

/**
 * Supprime le logo de l'organisation
 * @param {string} orgId
 */
export async function deleteLogo(orgId) {
  const dirPath = path.join(ORG_UPLOADS_ROOT, orgId);
  try {
    for (const ext of ALLOWED_EXT) {
      const filePath = path.join(dirPath, `logo${ext}`);
      await fs.unlink(filePath).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Retourne le chemin absolu du fichier logo si existant
 * @param {string} orgId
 * @returns {Promise<string|null>}
 */
export async function getLogoPath(orgId) {
  const dirPath = path.join(ORG_UPLOADS_ROOT, orgId);
  for (const ext of ALLOWED_EXT) {
    const filePath = path.join(dirPath, `logo${ext}`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch (_) {}
  }
  return null;
}

/**
 * Chemin absolu du fichier logo organisation (settings_json.logo_image_key ou legacy storage/org/.../logo.ext).
 * @param {string} organizationId
 * @returns {Promise<string|null>}
 */
export async function resolveOrgLogoAbsolutePath(organizationId) {
  const r = await pool.query("SELECT settings_json FROM organizations WHERE id = $1", [organizationId]);
  if (r.rows.length === 0) return null;
  const settings = r.rows[0].settings_json ?? {};
  const resolvedKey = settings.logo_image_key;
  if (resolvedKey) {
    try {
      return path.resolve(getAbsolutePath(resolvedKey));
    } catch {
      return null;
    }
  }
  return await getLogoPath(organizationId);
}
