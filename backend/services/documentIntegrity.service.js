/**
 * documentIntegrity.service.js
 *
 * Calcul et vérification du hash SHA-256 des fichiers PDF stockés localement.
 *
 * Principe :
 *  - À la persistance : computeFileHash(buffer) → stocker dans entity_documents.file_hash
 *  - Au téléchargement : verifyDocumentIntegrity(filePath, storedHash) → 409 si divergence
 *
 * Non-bloquant pour les documents sans hash (anciens PDFs) : si file_hash IS NULL en DB,
 * la vérification est ignorée (reason: NO_HASH_STORED).
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";

/**
 * Calcule le SHA-256 d'un Buffer en mémoire.
 * @param {Buffer} buffer
 * @returns {string} hash hexadécimal 64 caractères
 */
export function computeFileHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Calcule le SHA-256 d'un fichier depuis son chemin absolu (synchrone).
 * @param {string} filePath
 * @returns {string}
 */
export function computeFileHashFromPath(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Vérifie l'intégrité d'un fichier sur disque par comparaison de hash.
 *
 * @param {string} filePath — chemin absolu du fichier
 * @param {string|null|undefined} expectedHash — hash SHA-256 stocké en DB (file_hash)
 * @returns {{
 *   ok: boolean,
 *   reason?: "NO_HASH_STORED" | "HASH_MISMATCH" | "FILE_READ_ERROR",
 *   expected?: string,
 *   actual?: string,
 *   error?: string,
 * }}
 */
export function verifyDocumentIntegrity(filePath, expectedHash) {
  if (!expectedHash) {
    // Document antérieur à la feature — pas de hash stocké, on laisse passer
    return { ok: true, reason: "NO_HASH_STORED" };
  }

  try {
    const actual = computeFileHashFromPath(filePath);
    if (actual !== expectedHash) {
      return {
        ok: false,
        reason: "HASH_MISMATCH",
        expected: expectedHash,
        actual,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "FILE_READ_ERROR", error: e.message };
  }
}
