/**
 * CP-FAR-IGN-02 — Loader tuilé avec cache LRU et déduplication des requêtes en vol.
 */

import path from "path";
import { parseEsriAsciiGrid } from "./parseEsriAsciiGrid.js";
import { getIgnDsmDataDir } from "./ignRgeAltiConfig.js";

const DEFAULT_MAX_TILES = 8;

/**
 * @param {{ dataDir?: string, maxTiles?: number }} opts
 * @returns {{ loadTile: (pathRel: string) => Promise<{ grid: Float32Array, width: number, height: number, x0: number, y0: number, cellsize_m: number, noDataValue: number }> }}
 */
export function createIgnTileLoader(opts = {}) {
  const dataDir = opts.dataDir || getIgnDsmDataDir();
  const maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;

  const cache = new Map();
  const inflight = new Map();

  function getFullPath(pathRel) {
    return path.join(dataDir, pathRel.replace(/\//g, path.sep));
  }

  function evictLRU() {
    if (cache.size < maxTiles) return;
    const firstKey = cache.keys().next().value;
    if (firstKey != null) cache.delete(firstKey);
  }

  async function loadTile(pathRel) {
    const key = pathRel;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    let promise = inflight.get(key);
    if (promise) return promise;

    promise = (async () => {
      try {
        const fullPath = getFullPath(pathRel);
        const parsed = parseEsriAsciiGrid(fullPath);
        const meta = {
          grid: parsed.grid,
          width: parsed.width,
          height: parsed.height,
          x0: parsed.x0,
          y0: parsed.y0,
          cellsize_m: parsed.cellsize_m,
          noDataValue: parsed.noDataValue,
        };
        evictLRU();
        cache.set(key, meta);
        return meta;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  return { loadTile };
}
