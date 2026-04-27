/**
 * CP-032 — Service Stockage Local (VPS)
 * Arborescence: storage/{organizationId}/{entityType}/{entityId}/uuid_filename.ext
 * Aucun accès public direct — téléchargement via API uniquement
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { normalizeMultipartFilename } from "../utils/multipartFilenameUtf8.js";

/** Racine volume disque (Railway : `/app/storage`). Surcharge locale : `STORAGE_ROOT`. */
export const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || "/app/storage");

/**
 * Nom sûr pour segment de chemin disque : pas de séparateurs / contrôle,
 * conserve les lettres Unicode (accents, etc.).
 */
function sanitizeFileName(originalName) {
  const base = path.basename(String(originalName || "document").trim() || "document");
  const cleaned = base.replace(/\0/g, "").replace(/[/\\]/g, "_");
  return cleaned || "document";
}

/**
 * Upload un fichier en stockage local
 * @param {Buffer} buffer - Contenu du fichier
 * @param {string} organizationId - UUID organisation
 * @param {string} entityType - lead|client|study|quote
 * @param {string} entityId - UUID entité
 * @param {string} originalName - Nom original du fichier
 * @param {{ diskFileName?: string | null }} [options] — si défini, nom disque exact (déjà sécurisé, ex. fiches techniques)
 * @returns {{ storage_path: string, file_name: string }}
 */
export async function uploadFile(buffer, organizationId, entityType, entityId, originalName, options = {}) {
  const forcedRaw = options?.diskFileName != null ? String(options.diskFileName).trim() : "";
  let fileName;
  if (forcedRaw) {
    const forced = sanitizeFileName(forcedRaw.replace(/\0/g, "")) || `${randomUUID()}_document`;
    fileName = forced;
  } else {
    const uuid = randomUUID();
    const rawIn = String(originalName ?? "").trim();
    const normalized = normalizeMultipartFilename(rawIn);
    const decoded = (normalized || rawIn || "document").trim() || "document";
    const safeName = sanitizeFileName(decoded);
    fileName = `${uuid}_${safeName}`;
  }

  const dirPath = path.join(STORAGE_ROOT, organizationId, entityType, entityId);
  await fs.mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, fileName);
  console.log("[STORAGE FIX] filePath:", filePath);
  await fs.writeFile(filePath, buffer);

  const storage_path = [organizationId, entityType, entityId, fileName].join("/");
  return { storage_path, file_name: fileName };
}

/**
 * Pièces jointes mail — arborescence plate par mois (hors entité CRM).
 * Relatif STORAGE_ROOT : `{organizationId}/mail/{yyyy}/{mm}/{uuid}_{safeName}`
 * @param {Buffer} buffer
 * @param {string} organizationId
 * @param {string} originalName
 * @returns {Promise<{ storage_path: string, file_name: string }>}
 */
export async function uploadMailAttachmentFile(buffer, organizationId, originalName) {
  const uuid = randomUUID();
  const rawIn = String(originalName ?? "").trim();
  const normalized = normalizeMultipartFilename(rawIn);
  const decoded = (normalized || rawIn || "attachment").trim() || "attachment";
  const safeName = sanitizeFileName(decoded);
  const fileName = `${uuid}_${safeName}`;
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dirPath = path.join(STORAGE_ROOT, organizationId, "mail", yyyy, mm);
  await fs.mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, fileName);
  console.log("[STORAGE FIX] filePath:", filePath);
  await fs.writeFile(filePath, buffer);
  const storage_path = [organizationId, "mail", yyyy, mm, fileName].join("/");
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
  console.log("[STORAGE FIX] filePath:", resolved);
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
  console.log("[STORAGE FIX] filePath:", resolved);
  return resolved;
}
