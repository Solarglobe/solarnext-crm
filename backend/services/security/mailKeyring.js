import crypto from "node:crypto";

export function mailCryptoError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function decodeKey(raw) {
  if (typeof raw !== "string") throw mailCryptoError("MAIL_KEYRING_INVALID");
  const value = raw.trim();
  if (/^[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value, "hex");
  // Node's previous decoder also accepted unpadded/base64url keys. Preserve
  // those encodings while rejecting ignored characters and noncanonical bits.
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) throw mailCryptoError("MAIL_KEYRING_INVALID");
  const canonical = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const key = Buffer.from(canonical, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== canonical) throw mailCryptoError("MAIL_KEYRING_INVALID");
  return key;
}

/** Configuration snapshot; never return key material in diagnostics. */
export function readMailKeyring(env = process.env) {
  const rawRing = env.MAIL_ENCRYPTION_KEYS;
  const oldKey = env.MAIL_ENCRYPTION_KEY;
  if (!rawRing) {
    if (env.MAIL_ENCRYPTION_ACTIVE_KEY_ID || env.MAIL_ENCRYPTION_LEGACY_KEY_ID) throw mailCryptoError("MAIL_KEYRING_INCOMPLETE");
    // Existing installations can upgrade before rotation. New ciphertext has a
    // key ID even with the old single-key configuration; this is not a rotation.
    return { activeId: "legacy", legacyId: "legacy", explicit: false, keys: new Map([["legacy", decodeKey(oldKey)]]) };
  }
  let parsed;
  try { parsed = JSON.parse(rawRing); } catch { throw mailCryptoError("MAIL_KEYRING_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw mailCryptoError("MAIL_KEYRING_INVALID");
  const entries = Object.entries(parsed);
  // Key labels are plain ASCII identifiers. Reject duplicate JSON members and
  // escaped labels instead of accepting JSON.parse's silent last-value wins.
  const labels = [...String(rawRing).matchAll(/"([^"\\]*)"\s*:/g)].map(match => match[1]);
  if (labels.length !== entries.length || labels.some(id => !idPattern.test(id))) throw mailCryptoError("MAIL_KEYRING_INVALID");
  if (!entries.length || entries.length > 8) throw mailCryptoError("MAIL_KEYRING_INVALID");
  const keys = new Map();
  for (const [id, value] of entries) {
    if (!idPattern.test(id)) throw mailCryptoError("MAIL_KEYRING_INVALID");
    const key = decodeKey(value);
    for (const existing of keys.values()) {
      if (crypto.timingSafeEqual(existing, key)) throw mailCryptoError("MAIL_KEYRING_DUPLICATE_MATERIAL");
    }
    keys.set(id, key);
  }
  const activeId = env.MAIL_ENCRYPTION_ACTIVE_KEY_ID;
  const legacyId = env.MAIL_ENCRYPTION_LEGACY_KEY_ID || null;
  if (!keys.has(activeId) || (legacyId && !keys.has(legacyId))) throw mailCryptoError("MAIL_KEYRING_INCOMPLETE");
  if (oldKey && (!legacyId || !crypto.timingSafeEqual(decodeKey(oldKey), keys.get(legacyId)))) throw mailCryptoError("MAIL_KEYRING_AMBIGUOUS_LEGACY");
  return { activeId, legacyId, explicit: true, keys };
}
