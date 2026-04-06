/**
 * IGN Dynamic Tile Loader — Lock fichier (LOCAL) ou Postgres advisory (PG).
 * IGN_LOCK_MODE=LOCAL|PG (défaut LOCAL). Même API (meta, ttl), metrics activeLocks identiques.
 */

import fs from "fs";
import path from "path";
import { incrementActiveLocks, decrementActiveLocks } from "./ignMetrics.js";
import { acquirePgAdvisoryLock } from "./pgLocks.js";

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LOG_PREFIX = "[IGN Lock]";

function getLockMode() {
  const m = (process.env.IGN_LOCK_MODE || "LOCAL").toUpperCase();
  return m === "PG" ? "PG" : "LOCAL";
}

/**
 * Vérifie si un lock existe et est obsolète (plus vieux que ttlMs).
 * @param {string} lockPath - chemin du fichier lock
 * @param {number} [ttlMs] - TTL en ms (défaut 10 min)
 * @returns {boolean} true si le lock est stale (ou absent)
 */
export function isStale(lockPath, ttlMs = LOCK_TTL_MS) {
  try {
    if (!fs.existsSync(lockPath)) return true;
    const stat = fs.statSync(lockPath);
    const age = Date.now() - (stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : 0);
    return age > ttlMs;
  } catch {
    return true;
  }
}

/**
 * Supprime un lock obsolète (sans tenir compte du fd).
 * @param {string} lockPath
 */
function removeStaleLock(lockPath) {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch (_) {}
}

/**
 * Acquiert un lock exclusif : fichier (LOCAL) ou advisory Postgres (PG).
 * Même API : meta et ttl utilisés en LOCAL ; en PG pas de stale TTL (session libère si mort).
 * @param {string} lockPath - chemin du lock (ex: .../locks/D077.lock) ou nom pour PG
 * @param {number} [ttlMs] - TTL (LOCAL: stale) / timeout attente (PG)
 * @param {{ pid?: number, tileId?: string, [key: string]: unknown }} [meta] - ignoré en PG
 * @returns {Promise<{ fd: number | null, path: string, pgHandle?: { release: () => Promise<void> } } | null>}
 */
export async function acquireLock(lockPath, ttlMs = LOCK_TTL_MS, meta = {}) {
  if (getLockMode() === "PG") {
    const lockName = "ign:" + path.basename(lockPath, ".lock");
    const pgHandle = await acquirePgAdvisoryLock(lockName, ttlMs);
    if (!pgHandle) return null;
    incrementActiveLocks();
    return { fd: null, path: lockPath, pgHandle };
  }

  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (isStale(lockPath, ttlMs)) removeStaleLock(lockPath);

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      pid: meta.pid ?? process.pid,
      timestamp: Date.now(),
      tileId: meta.tileId ?? null,
      ...meta,
    });
    fs.open(lockPath, "wx", (err, fd) => {
      if (err) {
        resolve(null);
        return;
      }
      try {
        fs.writeSync(fd, payload, 0, "utf8");
        incrementActiveLocks();
        resolve({ fd, path: lockPath });
      } catch (e) {
        try { fs.closeSync(fd); } catch (_) {}
        try { fs.unlinkSync(lockPath); } catch (_) {}
        resolve(null);
      }
    });
  });
}

/**
 * Libère un lock (fichier ou PG). Accepte lockHandle entier ou (fd, lockPath).
 * @param {number | { fd?: number, path: string, pgHandle?: { release: () => Promise<void> } }} fdOrHandle
 * @param {string} [lockPath]
 */
export async function releaseLock(fdOrHandle, lockPath) {
  const h = typeof fdOrHandle === "object" && fdOrHandle !== null && "path" in fdOrHandle
    ? fdOrHandle
    : { fd: fdOrHandle, path: lockPath };

  if (h.pgHandle) {
    try {
      await h.pgHandle.release();
    } finally {
      decrementActiveLocks();
    }
    return;
  }
  try {
    if (typeof h.fd === "number") fs.closeSync(h.fd);
  } catch (_) {}
  try {
    if (h.path && fs.existsSync(h.path)) fs.unlinkSync(h.path);
  } catch (_) {}
  decrementActiveLocks();
}

/**
 * Attend qu'un lock soit libéré (poll) ou timeout.
 * PG : essaie d'acquérir le lock (poll 250ms) ; si acquis, release et return true. Sinon checkFileExists.
 * LOCAL : poll fichier lock + checkFileExists.
 * @param {string} lockPath - chemin du lock (ou nom pour PG)
 * @param {number} timeoutMs - max attente (ex: 90000)
 * @param {{ checkFileExists?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export async function waitForUnlock(lockPath, timeoutMs, opts = {}) {
  const checkPath = opts.checkFileExists || null;
  const start = Date.now();
  const pollMs = getLockMode() === "PG" ? 250 : 500;

  if (getLockMode() === "PG") {
    const lockName = "ign:" + path.basename(lockPath, ".lock");
    while (Date.now() - start < timeoutMs) {
      if (checkPath) {
        try {
          if (fs.existsSync(checkPath) && fs.statSync(checkPath).size > 0) return true;
        } catch (_) {}
      }
      const pgHandle = await acquirePgAdvisoryLock(lockName, 0);
      if (pgHandle) {
        await pgHandle.release();
        return true;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    if (checkPath) {
      try {
        if (fs.existsSync(checkPath) && fs.statSync(checkPath).size > 0) return true;
      } catch (_) {}
    }
    return false;
  }

  return new Promise((resolve) => {
    function poll() {
      if (!fs.existsSync(lockPath)) {
        resolve(true);
        return;
      }
      if (checkPath && fs.existsSync(checkPath)) {
        try {
          if (fs.statSync(checkPath).size > 0) {
            resolve(true);
            return;
          }
        } catch (_) {}
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(poll, pollMs);
    }
    poll();
  });
}
