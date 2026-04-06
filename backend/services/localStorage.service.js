/**
 * CP-032 — Service Stockage Local (VPS)
 * Arborescence: storage/{organizationId}/{entityType}/{entityId}/uuid_filename.ext
 * Aucun accès public direct — téléchargement via API uniquement
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.join(__dirname, "..", "storage");

/**
 * Nettoie le nom de fichier (caractères sûrs uniquement)
 */
function sanitizeFileName(originalName) {
  const base = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "document";
}

/**
 * Upload un fichier en stockage local
 * @param {Buffer} buffer - Contenu du fichier
 * @param {string} organizationId - UUID organisation
 * @param {string} entityType - lead|client|study|quote
 * @param {string} entityId - UUID entité
 * @param {string} originalName - Nom original du fichier
 * @returns {{ storage_path: string, file_name: string }}
 */
export async function uploadFile(buffer, organizationId, entityType, entityId, originalName) {
  const uuid = randomUUID();
  const safeName = sanitizeFileName(originalName || "document");
  const fileName = `${uuid}_${safeName}`;

  const dirPath = path.join(STORAGE_ROOT, organizationId, entityType, entityId);
  await fs.mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, fileName);
  await fs.writeFile(filePath, buffer);

  const storage_path = [organizationId, entityType, entityId, fileName].join("/");
  return { storage_path, file_name: fileName };
}

/**
 * Supprime un fichier du stockage local
 * @param {string} storagePath - Chemin relatif (org/entityType/entityId/uuid_filename.ext)
 * @dev FORCE_DELETE_FAIL=1 — pour tests d'intégrité (rollback DB si échec)
 */
export async function deleteFile(storagePath) {
  if (process.env.FORCE_DELETE_FAIL === "1") throw new Error("forced");
  if (!storagePath || typeof storagePath !== "string") return;
  const normalized = storagePath.replace(/\//g, path.sep);
  const fullPath = path.join(STORAGE_ROOT, normalized);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Chemin invalide (path traversal)");
  }
  try {
    await fs.unlink(resolved);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/**
 * Retourne le chemin absolu d'un fichier pour lecture
 * @param {string} storagePath - Chemin relatif stocké en DB
 * @returns {string} Chemin absolu
 */
export function getAbsolutePath(storagePath) {
  if (!storagePath || typeof storagePath !== "string") {
    throw new Error("storage_path invalide");
  }
  const normalized = storagePath.replace(/\//g, path.sep);
  const fullPath = path.join(STORAGE_ROOT, normalized);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("Chemin invalide (path traversal)");
  }
  return resolved;
}
