/**
 * CP-070 — Chiffrement AES-256-GCM pour secrets applicatifs (credentials mail, etc.).
 * Clé : MAIL_ENCRYPTION_KEY (32 octets en hex 64 chars ou base64).
 */

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

/**
 * @returns {Buffer}
 */
function getKeyBuffer() {
  const raw = String(process.env.MAIL_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error("MAIL_ENCRYPTION_KEY manquant");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const b = Buffer.from(raw, "base64");
  if (b.length !== KEY_LEN) {
    throw new Error("MAIL_ENCRYPTION_KEY doit décoder vers exactement 32 octets (AES-256)");
  }
  return b;
}

/**
 * Chiffre une chaîne UTF-8. Retourne un objet sérialisable en JSON (jsonb).
 *
 * @param {string} plaintext
 * @returns {{ v: 1, alg: 'aes-256-gcm', iv: string, tag: string, data: string }}
 */
export function encrypt(plaintext) {
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: enc.toString("base64"),
  };
}

/**
 * Déchiffre le payload produit par encrypt().
 *
 * @param {{ v: number, alg?: string, iv: string, tag: string, data: string }} payload
 * @returns {string}
 */
export function decrypt(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload de déchiffrement invalide");
  }
  if (payload.v !== 1 || payload.alg !== "aes-256-gcm") {
    throw new Error("Version ou algorithme de chiffrement non supporté");
  }
  const key = getKeyBuffer();
  const iv = Buffer.from(String(payload.iv), "base64");
  const tag = Buffer.from(String(payload.tag), "base64");
  const data = Buffer.from(String(payload.data), "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * Enveloppe JSON (ex. credentials) → chiffrée.
 *
 * @param {Record<string, unknown>} obj
 */
export function encryptJson(obj) {
  return encrypt(JSON.stringify(obj));
}

/**
 * @param {{ v: number, alg?: string, iv: string, tag: string, data: string }} payload
 * @returns {Record<string, unknown>}
 */
export function decryptJson(payload) {
  return JSON.parse(decrypt(payload));
}
