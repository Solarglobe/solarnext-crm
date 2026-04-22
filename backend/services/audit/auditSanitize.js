/**
 * CP-072 — Métadonnées audit : pas de secrets, pas de gros JSON techniques.
 */

const FORBIDDEN_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "cookies",
  "secret",
  "api_key",
  "apiKey",
]);

const MAX_STRING = 2000;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;

/**
 * @param {unknown} input
 * @param {number} depth
 * @returns {Record<string, unknown> | unknown[] | string | number | boolean | null}
 */
export function sanitizeAuditMetadata(input, depth = 0) {
  if (input === null || input === undefined) return null;
  if (depth > MAX_DEPTH) return "[truncated]";

  if (typeof input === "string") {
    const t = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…` : input;
    return t;
  }
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "boolean") return input;

  if (Array.isArray(input)) {
    const out = [];
    for (let i = 0; i < Math.min(input.length, 50); i++) {
      out.push(sanitizeAuditMetadata(input[i], depth + 1));
    }
    return out;
  }

  if (typeof input === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    const keys = Object.keys(input).slice(0, MAX_KEYS);
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
      const v = /** @type {Record<string, unknown>} */ (input)[k];
      if (typeof v === "string" && v.length > 5000) continue;
      out[k] = sanitizeAuditMetadata(v, depth + 1);
    }
    return out;
  }

  return String(input).slice(0, 200);
}
