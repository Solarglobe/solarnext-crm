/**
 * CP-FAR-006 — Cache Horizon par tuile géographique
 * TTL configurable, inflight dedupe, multi-tenant safe.
 * Interface prête pour évolution Redis.
 */

import { getHorizonCacheDsmSuffix } from "./horizonDsmGate.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ITEMS = 2000;
const DEFAULT_TILE_DEG = 0.01;

function getConfig() {
  const ttl = process.env.HORIZON_CACHE_TTL_MS;
  const maxItems = process.env.HORIZON_CACHE_MAX_ITEMS;
  const tileDeg = process.env.HORIZON_CACHE_TILE_DEG;
  return {
    ttlMs: ttl != null && ttl !== "" ? parseInt(ttl, 10) : DEFAULT_TTL_MS,
    maxItems: maxItems != null && maxItems !== "" ? parseInt(maxItems, 10) : DEFAULT_MAX_ITEMS,
    tileDeg: tileDeg != null && tileDeg !== "" ? parseFloat(tileDeg) : DEFAULT_TILE_DEG,
  };
}

/**
 * CP-FAR-007–009 — Suffixe cache aligné sur le gate terrain réel (POINT 6D).
 * @returns {string} ex. :dsm=0 | :dsm=geotiff | :dsm=ign | :dsm=real
 */
export function getDsmSuffix() {
  return getHorizonCacheDsmSuffix();
}

function getHdSuffix(enableHD, step_deg, radius_m) {
  if (!enableHD) return "";
  const maxDist =
    process.env.FAR_HORIZON_HD_MAX_DIST_M != null && process.env.FAR_HORIZON_HD_MAX_DIST_M !== ""
      ? process.env.FAR_HORIZON_HD_MAX_DIST_M
      : 4000;
  return `:hd=1:step=${step_deg}:max=${maxDist}`;
}

/**
 * Génère la clé cache par tuile.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radius_m
 * @param {number} step_deg
 * @param {number} tileSizeDeg
 * @param {string} tenantKey
 * @param {boolean} [enableHD]
 */
export function tileKey(lat, lon, radius_m, step_deg, tileSizeDeg, tenantKey = "public", enableHD = false) {
  const tileLat = Math.floor(lat / tileSizeDeg) * tileSizeDeg;
  const tileLon = Math.floor(lon / tileSizeDeg) * tileSizeDeg;
  const effRadius = enableHD
    ? (process.env.FAR_HORIZON_HD_MAX_DIST_M != null && process.env.FAR_HORIZON_HD_MAX_DIST_M !== ""
        ? parseInt(process.env.FAR_HORIZON_HD_MAX_DIST_M, 10)
        : 4000)
    : radius_m;
  return `${tenantKey}:${tileLat.toFixed(5)}:${tileLon.toFixed(5)}:${effRadius}:${step_deg}:tile=${tileSizeDeg}${getDsmSuffix()}${getHdSuffix(enableHD, step_deg, effRadius)}`;
}

const cacheStore = new Map();
const inflight = new Map();

let statsComputes = 0;
let statsHits = 0;
let statsMisses = 0;
let statsInflightWaits = 0;

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
 * Récupère ou calcule le horizon mask.
 * @param {{ tenantKey?: string, lat: number, lon: number, radius_m?: number, step_deg?: number }} params
 * @param {() => Promise<object> | object} computeFn - Fonction synchrone ou async
 * @returns {Promise<{ value: object, cached: boolean }>}
 */
export async function getOrComputeHorizonMask(params, computeFn) {
  const { tenantKey = "public", lat, lon, radius_m = 500, step_deg = 2, enableHD = false } = params || {};
  const { ttlMs, tileDeg } = getConfig();

  const key = tileKey(lat, lon, radius_m, step_deg, tileDeg, tenantKey, enableHD);

  purge();

  const entry = cacheStore.get(key);
  const now = Date.now();
  if (entry && entry.expiresAt > now) {
    statsHits++;
    return { value: entry.value, cached: true };
  }

  const existingPromise = inflight.get(key);
  if (existingPromise) {
    statsInflightWaits++;
    const result = await existingPromise;
    return result;
  }

  statsMisses++;
  statsComputes++;

  const computePromise = (async () => {
    try {
      const value = await Promise.resolve(computeFn());
      const expiresAt = now + ttlMs;
      cacheStore.set(key, {
        value,
        expiresAt,
        createdAt: now,
      });
      return { value, cached: false };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, computePromise);
  return computePromise;
}

/**
 * Hook INTERNAL pour tests uniquement.
 * @returns {{ computes: number, hits: number, misses: number, inflightWaits: number }}
 */
export function __testGetStats() {
  return {
    computes: statsComputes,
    hits: statsHits,
    misses: statsMisses,
    inflightWaits: statsInflightWaits,
  };
}

/**
 * Réinitialise stats (pour tests).
 */
export function __testResetStats() {
  statsComputes = 0;
  statsHits = 0;
  statsMisses = 0;
  statsInflightWaits = 0;
}

/**
 * Vide le cache (pour tests TTL).
 */
export function __testClearCache() {
  cacheStore.clear();
  inflight.clear();
}
