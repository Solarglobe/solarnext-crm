/**
 * CP-FAR-MNS-01 — Loader tuilé GeoTIFF Lambert-93 (MNS / MNH LiDAR HD IGN).
 *
 * Les dalles LiDAR HD (MNS = sol + arbres + bâti, MNH = hauteur des objets) sont
 * diffusées par l'IGN en GeoTIFF 1 km × 1 km, projection Lambert-93 (EPSG:2154),
 * pas 50 cm (ou 5 m). Ce loader décode une dalle locale et renvoie EXACTEMENT le
 * même format de tuile que parseEsriAsciiGrid / createIgnTileLoader, afin de
 * réutiliser sans modification heightSampler2154, buildLocalGrid2154 et le raycast HD.
 *
 * Contrat de sortie (identique au loader ASCII) :
 *   { grid: Float32Array, width, height, x0, y0, cellsize_m, noDataValue }
 *   — origine (x0, y0) = coin BAS-GAUCHE en mètres Lambert-93
 *   — grid indexée grid[row * width + col] avec row 0 = Y MINIMUM (bas)
 *
 * ⚠️ Un GeoTIFF nord-up stocke la première ligne au Nord (Y max). Le sampler
 * (heightSampler2154) attend row 0 = Y min. Ce loader effectue donc un flip
 * vertical à la lecture. C'est le point sensible : voir test unitaire dédié.
 */

import path from "path";
import { fromFile } from "geotiff";
import { getLidarSurfaceDataDir } from "../dsm/dsmConfig.js";

const DEFAULT_MAX_TILES = 8;
const M_PER_DEG_LAT = 111320; // fallback uniquement (dalles L93 = mètres natifs)

/**
 * Décode une dalle GeoTIFF Lambert-93 en grille flottante orientée bas-gauche.
 * @param {string} fullPath chemin absolu vers le .tif
 * @returns {Promise<{ grid: Float32Array, width: number, height: number, x0: number, y0: number, cellsize_m: number, noDataValue: number }>}
 */
export async function decodeLidarGeotiffTile(fullPath) {
  const tiff = await fromFile(fullPath);
  const image = await tiff.getImage(0);

  const width = image.getWidth();
  const height = image.getHeight();

  const rasters = await image.readRasters();
  const raster = Array.isArray(rasters) ? rasters[0] : rasters;

  // Géotransformation. Pour une dalle L93 nord-up :
  //   ModelPixelScale = [sx, sy, 0]  (sx = sy = taille pixel en mètres)
  //   ModelTiepoint   = [i, j, k, X, Y, Z] → (X, Y) = coin HAUT-GAUCHE (Y max)
  let sx;
  let topLeftX;
  let topLeftY;
  try {
    const scale = image.fileDirectory.ModelPixelScale;
    const tiepoint = image.fileDirectory.ModelTiepoint;
    if (scale && tiepoint) {
      sx = Math.abs(scale[0]);
      topLeftX = tiepoint[3];
      topLeftY = tiepoint[4];
    }
  } catch (_) {
    /* fallback ci-dessous */
  }

  if (sx == null || topLeftX == null || topLeftY == null) {
    // Fallback via bbox (moins précis, mais dalles L93 = mètres)
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
    topLeftX = bbox[0];
    topLeftY = bbox[3];
    sx = (bbox[2] - bbox[0]) / width;
    if (!Number.isFinite(sx) || sx <= 0) {
      sx = M_PER_DEG_LAT; // dernier recours — ne devrait jamais arriver sur dalle L93
    }
  }

  const cellsize_m = sx;
  const x0 = topLeftX; // coin gauche = X min
  const y0 = topLeftY - height * cellsize_m; // coin bas = Y max - hauteur

  // NODATA
  let noDataValue = -99999;
  try {
    const nd = image.fileDirectory.GDAL_NODATA;
    if (nd != null) {
      const parsed = parseFloat(String(nd));
      if (Number.isFinite(parsed)) noDataValue = parsed;
    }
  } catch (_) {
    /* garde le défaut */
  }

  // Flip vertical : GeoTIFF ligne 0 = Nord (Y max) → on veut ligne 0 = Y min.
  const src = raster;
  const grid = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    const srcRow = height - 1 - r; // ligne source (haut-first) correspondant à la ligne bas-first r
    const srcBase = srcRow * width;
    const dstBase = r * width;
    for (let c = 0; c < width; c++) {
      const v = Number(src[srcBase + c]);
      grid[dstBase + c] = v === noDataValue || Number.isNaN(v) ? NaN : v;
    }
  }

  return { grid, width, height, x0, y0, cellsize_m, noDataValue };
}

/**
 * Loader tuilé avec cache LRU + déduplication des requêtes en vol.
 * API identique à createIgnTileLoader (ASCII) : { loadTile(pathRel) }.
 * @param {{ dataDir?: string, maxTiles?: number }} opts
 */
export function createIgnLidarGeotiffTileLoader(opts = {}) {
  const dataDir = opts.dataDir || getLidarSurfaceDataDir();
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
        const meta = await decodeLidarGeotiffTile(getFullPath(pathRel));
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
