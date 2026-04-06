/**
 * IGN Dynamic Tile Loader — Limite taille cache disque (LRU par mtime).
 * Ne supprime jamais index.json (qui est hors du dossier cache).
 */

import fs from "fs";
import path from "path";

function getMaxCacheMb() {
  const v = process.env.IGN_MAX_CACHE_MB;
  return v != null && v !== "" ? Math.max(1, parseInt(v, 10)) : 2048;
}

/**
 * Calcule la taille totale du dossier cache (fichiers .asc uniquement).
 * @param {string} cacheRoot - chemin racine du cache (getIgnCacheRoot())
 * @returns {{ sizeBytes: number, files: Array<{ path: string, size: number, mtime: number }> }}
 */
export function getCacheStats(cacheRoot) {
  const files = [];
  if (!cacheRoot || !fs.existsSync(cacheRoot)) {
    return { sizeBytes: 0, files: [] };
  }
  try {
    const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith(".asc")) continue;
      const fullPath = path.join(cacheRoot, e.name);
      try {
        const stat = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          size: stat.size,
          mtime: stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : 0,
        });
      } catch (_) {}
    }
  } catch (_) {}
  const sizeBytes = files.reduce((acc, f) => acc + f.size, 0);
  return { sizeBytes, files };
}

/**
 * Taille du cache en octets.
 * @param {string} cacheRoot
 * @returns {number}
 */
export function getIgnCacheSizeBytes(cacheRoot) {
  return getCacheStats(cacheRoot).sizeBytes;
}

/**
 * Si la taille du cache dépasse IGN_MAX_CACHE_MB, supprime les tuiles les plus anciennes (LRU mtime).
 * Ne touche jamais à index.json (hors de cacheRoot).
 * @param {string} cacheRoot
 * @returns {{ removedMb: number } | null} removedMb si nettoyage effectué, null sinon
 */
export function runCacheCleanupIfNeeded(cacheRoot) {
  const maxBytes = getMaxCacheMb() * 1024 * 1024;
  const { sizeBytes, files } = getCacheStats(cacheRoot);
  if (sizeBytes <= maxBytes || files.length === 0) return null;

  // Trier par mtime asc (plus ancien en premier)
  const sorted = [...files].sort((a, b) => a.mtime - b.mtime);
  let removed = 0;
  let currentTotal = sizeBytes;

  for (const f of sorted) {
    if (currentTotal <= maxBytes) break;
    try {
      fs.unlinkSync(f.path);
      currentTotal -= f.size;
      removed += f.size;
    } catch (_) {}
  }

  if (removed > 0) {
    const removedMb = Math.round((removed / (1024 * 1024)) * 100) / 100;
    console.warn(`[IGN DYNAMIC] Cache cleanup removed ${removedMb} MB`);
    return { removedMb };
  }
  return null;
}
