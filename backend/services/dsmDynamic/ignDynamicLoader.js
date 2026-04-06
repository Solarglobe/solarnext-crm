/**
 * IGN Dynamic Tile Loader — Orchestrateur principal.
 * Cache intelligent, lock anti-concurrence, inflight map, multi-tenant safe.
 * N'appelle pas computeHorizonMaskAuto.
 */

import path from "path";
import fs from "fs";
import { resolveIgnTileForLatLon, listCandidateTilesForPoint } from "./ignTileResolver.js";
import { downloadIgnTile } from "./ignTileDownloader.js";
import { updateIgnIndexWithTile } from "./ignIndexUpdater.js";
import { getIgnDataDir, getIgnLocksRoot, getIgnCacheRoot } from "./paths.js";
import { acquireLock, releaseLock, waitForUnlock } from "./lockfile.js";
import { parseEsriAsciiGridHeader } from "../horizon/providers/ign/parseEsriAsciiGrid.js";
import { incrementCacheHit, openCircuitIfThreshold, isCircuitOpen } from "./ignMetrics.js";
import { runCacheCleanupIfNeeded } from "./ignCacheCleanup.js";

const LOCK_TTL_MS = 10 * 60 * 1000;   // 10 min
const WAIT_UNLOCK_MS = 90_000;         // 90 s max attente si lock pris

/** In-flight: une seule Promise par tileId dans ce process (évite double téléchargement). */
const inflight = new Map();

/**
 * Nom de fichier lock safe pour un tileId (caractères sûrs).
 * @param {string} tileId
 * @returns {string}
 */
function lockFileName(tileId) {
  return (tileId || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_") + ".lock";
}

function existsLocallyWithChecksum(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

/**
 * Tente de télécharger une tuile (lock, download, update index). Throw si échec.
 * @param {string} tileId
 * @param {string} expectedPath
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ ok: boolean, tileId: string, downloaded: boolean }>}
 */
async function tryDownloadOneTile(tileId, expectedPath, lat, lon) {
  runCacheCleanupIfNeeded(getIgnCacheRoot());

  const locksRoot = getIgnLocksRoot();
  const lockPath = path.join(locksRoot, lockFileName(tileId));

  let lockHandle = await acquireLock(lockPath, LOCK_TTL_MS, { tileId });
  if (!lockHandle) {
    const unlocked = await waitForUnlock(lockPath, WAIT_UNLOCK_MS, { checkFileExists: expectedPath });
    if (unlocked && existsLocallyWithChecksum(expectedPath)) {
      return { ok: true, tileId, downloaded: false };
    }
    throw new Error(`Lock timeout for tile ${tileId} (fallback will handle)`);
  }

  try {
    if (existsLocallyWithChecksum(expectedPath)) {
      await releaseLock(lockHandle);
      return { ok: true, tileId, downloaded: false };
    }

    console.log("[IGN DYNAMIC] Tile missing");
    console.log("[IGN DYNAMIC] Downloading tile", tileId);
    const downloadResult = await downloadIgnTile(tileId);

    if (!downloadResult.success) {
      openCircuitIfThreshold();
      await releaseLock(lockHandle);
      throw new Error(downloadResult.error ?? "Download failed");
    }

    const localPath = downloadResult.localPath ?? expectedPath;
    let bbox;
    try {
      const header = parseEsriAsciiGridHeader(localPath);
      bbox = {
        minX: header.x0,
        minY: header.y0,
        maxX: header.x1,
        maxY: header.y1,
        cellsize_m: header.cellsize_m,
        width: header.width,
        height: header.height,
        noDataValue: header.noDataValue,
      };
    } catch (err) {
      await releaseLock(lockHandle);
      throw new Error(`Failed to read tile header: ${err?.message ?? err}`);
    }

    const dataDir = getIgnDataDir();
    const pathRel = path.relative(dataDir, localPath);
    const updateResult = await updateIgnIndexWithTile(tileId, pathRel, bbox);
    await releaseLock(lockHandle);

    if (!updateResult.success) {
      throw new Error(updateResult.error ?? "Index update failed");
    }

    console.log("[IGN DYNAMIC] Index updated");
    return { ok: true, tileId, downloaded: true };
  } catch (err) {
    await releaseLock(lockHandle);
    throw err;
  }
}

/**
 * S'assure qu'une tuile IGN est disponible pour le point (lat, lon).
 * Si elle existe déjà localement → OK. Sinon : liste candidats (bundle), tente chaque candidat jusqu'à succès.
 * @param {number} lat - latitude WGS84 (degrés)
 * @param {number} lon - longitude WGS84 (degrés)
 * @returns {Promise<{ ok: boolean, tileId?: string, existed?: boolean, downloaded?: boolean, error?: string }>}
 */
export async function ensureIgnTileAvailable(lat, lon) {
  const resolved = await resolveIgnTileForLatLon(lat, lon);

  if (resolved.existsLocally) {
    incrementCacheHit();
    return { ok: true, tileId: resolved.tileId, existed: true };
  }

  const candidates = await listCandidateTilesForPoint(lat, lon);
  const tileIds = candidates.length ? candidates : [resolved.tileId];
  const cacheDir = getIgnCacheRoot();

  for (const cid of tileIds) {
    const expectedPath = path.join(cacheDir, `${cid}.asc`);
    if (existsLocallyWithChecksum(expectedPath)) {
      incrementCacheHit();
      return { ok: true, tileId: cid, existed: true };
    }

    if (isCircuitOpen()) {
      return { ok: false, error: "Circuit breaker open" };
    }

    const existing = inflight.get(cid);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await tryDownloadOneTile(cid, expectedPath, lat, lon);
      } finally {
        inflight.delete(cid);
      }
    })();

    inflight.set(cid, promise);
    try {
      const result = await promise;
      return { ...result, existed: !result.downloaded };
    } catch (_) {
      continue;
    }
  }

  return { ok: false, error: "No IGN tile could be downloaded (fallback will handle)" };
}
