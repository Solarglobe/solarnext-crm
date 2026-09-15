import crypto from "node:crypto";
import { readMailKeyring, mailCryptoError } from "./mailKeyring.js";

const ALGO = "aes-256-gcm";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const aad = kid => Buffer.from(JSON.stringify(["solarnext-mail", 2, ALGO, kid]), "utf8");

function decodeBase64(value, length) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw mailCryptoError("MAIL_CIPHERTEXT_INVALID");
  const result = Buffer.from(value, "base64");
  if (result.toString("base64") !== value || (length !== undefined && result.length !== length)) throw mailCryptoError("MAIL_CIPHERTEXT_INVALID");
  return result;
}

/** V2 authenticates version, algorithm and public key ID with GCM AAD.
 * V1 is the historical {v:1,alg,iv,tag,data} format without AAD or key ID.
 */
export function createMailCipher(env = process.env) {
  const { keys, activeId, legacyId, explicit } = readMailKeyring(env);
  function encryptValue(plaintext) {
    if (typeof plaintext !== "string") throw mailCryptoError("MAIL_PLAINTEXT_INVALID");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, keys.get(activeId), iv, { authTagLength: 16 });
    cipher.setAAD(aad(activeId));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { v: 2, alg: ALGO, kid: activeId, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  }
  function decryptValue(payload, { activeOnly = false } = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.alg !== ALGO) throw mailCryptoError("MAIL_CIPHERTEXT_INVALID");
    let key;
    if (payload.v === 1 && payload.kid === undefined && !activeOnly) {
      key = legacyId && keys.get(legacyId);
    } else if (payload.v === 2 && typeof payload.kid === "string" && idPattern.test(payload.kid)) {
      key = (!activeOnly || payload.kid === activeId) && keys.get(payload.kid);
    } else {
      throw mailCryptoError("MAIL_CIPHERTEXT_VERSION_UNSUPPORTED");
    }
    if (!key) throw mailCryptoError("MAIL_CIPHERTEXT_KEY_UNAVAILABLE");
    const iv = decodeBase64(payload.iv, 12), tag = decodeBase64(payload.tag, 16), data = decodeBase64(payload.data);
    try {
      const decipher = crypto.createDecipheriv(ALGO, key, iv, { authTagLength: 16 });
      if (payload.v === 2) decipher.setAAD(aad(payload.kid));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      throw mailCryptoError("MAIL_CIPHERTEXT_AUTH_FAILED");
    }
  }
  return Object.freeze({
    activeId, legacyId, explicit,
    rotationReady: explicit && activeId !== legacyId,
    encrypt: encryptValue,
    decrypt: decryptValue,
    encryptJson: value => encryptValue(JSON.stringify(value)),
    decryptJson(payload, options) {
      const text = decryptValue(payload, options);
      try { return JSON.parse(text); } catch { throw mailCryptoError("MAIL_PLAINTEXT_JSON_INVALID"); }
    },
  });
}

export const encrypt = plaintext => createMailCipher().encrypt(plaintext);
export const decrypt = payload => createMailCipher().decrypt(payload);
export const encryptJson = value => createMailCipher().encryptJson(value);
export const decryptJson = payload => createMailCipher().decryptJson(payload);
