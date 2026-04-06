/**
 * CP-FAR-008 — Cache tuiles DSM (GeoTIFF décodé)
 * Cache la grille Float32Array pour éviter redécodage.
 * Clé multi-tenant + provider config hash.
 */

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const DEFAULT_MAX_ITEMS = 500;

function getConfig() {
  const ttl = process.env.DSM_CACHE_TTL_MS;
  const maxItems = process.env.DSM_CACHE_MAX_ITEMS;
  return {
    ttlMs: ttl != null && ttl !== "" ? parseInt(ttl, 10) : DEFAULT_TTL_MS,
    maxItems: maxItems != null && maxItems !== "" ? parseInt(maxItems, 10) : DEFAULT_MAX_ITEMS,
  };
}

function getConfigHash() {
  const url = process.env.DSM_GEOTIFF_URL_TEMPLATE || "";
  return Buffer.from(url).toString("base64").slice(0, 16);
}

/**
 * @param {string} orgId
 * @param {number} z
 * @param {number} x
 * @param {number} y
 */
export function dsmTileKey(orgId, z, x, y) {
  const configHash = getConfigHash();
  return `dsm:${orgId || "public"}:${configHash}:${z}:${x}:${y}`;
}

const cacheStore = new Map();

function purge() {
  const { maxItems } = getConfig();
  const now = Date.now();

  for (const [k, v] of cacheStore.entries()) {
    if (v.expiresAt <= now) cacheStore.delete(k);
  }

  if (cacheStore.size > maxItems) {
    const entries = [...cacheStore.entries()];
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toDelete = entries.slice(0, cacheStore.size - maxItems);
    for (const [k] of toDelete) cacheStore.delete(k);
  }
}

/**
 * @param {string} key
 * @returns {{ grid: Float32Array, width: number, height: number, origin: object, stepMeters: number, noDataValue?: number, meta: object } | null}
 */
export function getDsmTile(key) {
  purge();
  const entry = cacheStore.get(key);
  const now = Date.now();
  if (entry && entry.expiresAt > now) {
    return entry.value;
  }
  return null;
}

/**
 * @param {string} key
 * @param {object} value
 */
export function setDsmTile(key, value) {
  const { ttlMs } = getConfig();
  const now = Date.now();
  cacheStore.set(key, {
    value,
    expiresAt: now + ttlMs,
    createdAt: now,
  });
}

export function __testClearDsmCache() {
  cacheStore.clear();
}
