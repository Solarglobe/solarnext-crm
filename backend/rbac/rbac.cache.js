/**
 * CP-026 RBAC — Cache in-memory simple avec TTL optionnel
 */

const DEFAULT_TTL_MS = 60_000; // 1 minute

const cache = new Map();

/**
 * @param {string} key
 * @param {number} [ttlMs]
 * @returns {Set<string> | undefined}
 */
export function get(key, ttlMs = DEFAULT_TTL_MS) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * @param {string} key
 * @param {Set<string>} value
 * @param {number} [ttlMs]
 */
export function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

/**
 * @param {string} key
 */
export function invalidate(key) {
  cache.delete(key);
}

/**
 * Invalide tout le cache (utile pour tests)
 */
export function clear() {
  cache.clear();
}
