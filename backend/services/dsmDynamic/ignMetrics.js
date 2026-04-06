/**
 * IGN Dynamic Tile Loader — Métriques et circuit breaker (prod-grade).
 * Aucun impact computeHorizonMaskAuto / shading JSON.
 */

const metrics = {
  downloads: 0,
  cacheHits: 0,
  failures: 0,
  totalDownloadTimeMs: 0,
  activeLocks: 0,
};

/** Fenêtre glissante des timestamps d'échecs (pour circuit breaker). */
const failureTimestamps = [];
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_DURATION_MS = 2 * 60_000;
let circuitOpenUntil = 0;

function getMaxFailuresPerMinute() {
  const v = process.env.IGN_MAX_FAILURES_PER_MINUTE;
  return v != null && v !== "" ? Math.max(1, parseInt(v, 10)) : 20;
}

function pruneOldFailures() {
  const now = Date.now();
  const cutoff = now - CIRCUIT_WINDOW_MS;
  while (failureTimestamps.length > 0 && failureTimestamps[0] < cutoff) {
    failureTimestamps.shift();
  }
}

export function incrementDownload(durationMs) {
  metrics.downloads += 1;
  metrics.totalDownloadTimeMs += durationMs || 0;
}

export function incrementCacheHit() {
  metrics.cacheHits += 1;
}

export function incrementFailure() {
  metrics.failures += 1;
  failureTimestamps.push(Date.now());
  pruneOldFailures();
}

export function incrementActiveLocks() {
  metrics.activeLocks += 1;
}

export function decrementActiveLocks() {
  if (metrics.activeLocks > 0) metrics.activeLocks -= 1;
}

export function getMetrics() {
  return { ...metrics };
}

export function resetMetrics() {
  metrics.downloads = 0;
  metrics.cacheHits = 0;
  metrics.failures = 0;
  metrics.totalDownloadTimeMs = 0;
  metrics.activeLocks = 0;
  failureTimestamps.length = 0;
  circuitOpenUntil = 0;
}

/**
 * À appeler après incrementFailure() : vérifie si le circuit doit s'ouvrir (fenêtre 60s).
 * @returns {boolean} true si le circuit vient de s'ouvrir
 */
export function openCircuitIfThreshold() {
  pruneOldFailures();
  const limit = getMaxFailuresPerMinute();
  if (failureTimestamps.length > limit) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
    console.warn("[IGN DYNAMIC] Circuit breaker OPEN");
    return true;
  }
  return false;
}

/**
 * Vérifie si le circuit breaker est ouvert (download désactivé temporairement).
 * @returns {boolean}
 */
export function isCircuitOpen() {
  pruneOldFailures();
  if (Date.now() < circuitOpenUntil) return true;
  circuitOpenUntil = 0;
  return false;
}
