/**
 * CP-FAR-008 — Provider DSM HTTP GeoTIFF (réel)
 * Télécharge et décode des tuiles GeoTIFF pour produire une grille d'altitudes.
 * IGN/Copernicus ready via URL template configurable.
 */

import { fromArrayBuffer } from "geotiff";

const M_PER_DEG_LAT = 111320;
const DEBUG = process.env.DSM_DEBUG === "true" || process.env.FAR_DEBUG === "true";

function log(...args) {
  if (DEBUG) console.log("[DSM:GeoTIFF]", ...args);
}

function getConfig() {
  const urlTemplate = process.env.DSM_GEOTIFF_URL_TEMPLATE || "";
  const timeout = process.env.DSM_REQUEST_TIMEOUT_MS;
  const maxConcurrency = process.env.DSM_MAX_CONCURRENCY;
  return {
    urlTemplate: urlTemplate.trim(),
    timeoutMs: timeout != null && timeout !== "" ? parseInt(timeout, 10) : 8000,
    maxConcurrency: maxConcurrency != null && maxConcurrency !== "" ? parseInt(maxConcurrency, 10) : 4,
  };
}

/**
 * Converts lat/lon to tile indices (Web Mercator / Slippy map convention).
 * @param {number} lat
 * @param {number} lon
 * @param {number} z - zoom level
 */
function latLonToTile(lat, lon, z) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y, z };
}

/**
 * @param {string} urlTemplate - e.g. "https://.../{z}/{x}/{y}.tif"
 * @param {number} z
 * @param {number} x
 * @param {number} y
 */
function buildTileUrl(urlTemplate, z, x, y) {
  return urlTemplate
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/**
 * @param {string} url
 * @param {{ timeout?: number, signal?: AbortSignal }} options
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchGeotiff(url, { timeout = 8000, signal } = {}) {
  const controller = signal ? null : new AbortController();
  const effectiveSignal = signal || controller?.signal;

  const timeoutId = setTimeout(() => {
    if (controller) controller.abort();
  }, timeout);

  try {
    const res = await fetch(url, {
      signal: effectiveSignal,
      headers: { Accept: "image/tiff" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    return buffer;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ grid: Float32Array, width: number, height: number, origin: { lat: number, lon: number }, stepMeters: number, noDataValue?: number }>}
 */
export async function decodeGeotiffToFloatGrid(arrayBuffer) {
  const tiff = await fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage(0);

  const rasters = await image.readRasters();
  const raster = Array.isArray(rasters) ? rasters[0] : rasters;
  const width = image.getWidth();
  const height = image.getHeight();

  let grid;
  if (raster instanceof Float32Array) {
    grid = new Float32Array(raster);
  } else if (raster instanceof Float64Array) {
    grid = new Float32Array(raster);
  } else {
    grid = new Float32Array(raster.length);
    for (let i = 0; i < raster.length; i++) {
      grid[i] = Number(raster[i]);
    }
  }

  let scale, tiepoint;
  try {
    scale = image.fileDirectory.getValue("ModelPixelScale");
    tiepoint = image.fileDirectory.getValue("ModelTiepoint");
  } catch (_) {
    scale = null;
    tiepoint = null;
  }

  let originLon, originLat, stepMeters;
  if (scale && tiepoint) {
    const [sx, sy] = scale;
    const [, , , gx, gy] = tiepoint;
    originLon = gx;
    originLat = gy;
    stepMeters = Math.abs(sx * M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180));
  } else {
    const bbox = image.getBoundingBox();
    originLon = bbox[0];
    originLat = bbox[3];
    stepMeters = 30;
  }

  let noDataValue;
  try {
    noDataValue = image.fileDirectory.getValue("GDAL_NODATA");
  } catch (_) {
    noDataValue = null;
  }
  if (typeof noDataValue === "string") {
    const parsed = parseFloat(noDataValue);
    if (!isNaN(parsed)) {
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === parsed || (isNaN(grid[i]) && isNaN(parsed))) {
          grid[i] = NaN;
        }
      }
    }
  }

  return {
    grid,
    width,
    height,
    origin: { lat: originLat, lon: originLon },
    stepMeters,
    noDataValue: noDataValue != null ? parseFloat(String(noDataValue)) : undefined,
  };
}

/**
 * @param {Object} params
 * @param {string} [params.organizationId]
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {number} params.radiusMeters
 * @param {number} [params.resolutionMeters]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ grid: Float32Array, width: number, height: number, origin: { lat: number, lon: number }, stepMeters: number, noDataValue?: number, meta: object }>}
 */
export async function getTileHeights(params) {
  const { lat, lon, radiusMeters = 500, resolutionMeters = 30, signal, _zoomOverride } = params;
  const { urlTemplate, timeoutMs } = getConfig();

  if (!urlTemplate) {
    throw new Error("DSM_GEOTIFF_URL_TEMPLATE not configured");
  }

  const z = _zoomOverride != null ? _zoomOverride : 15;
  const { x, y } = latLonToTile(lat, lon, z);
  const url = buildTileUrl(urlTemplate, z, x, y);

  log("fetch", url);

  const arrayBuffer = await fetchGeotiff(url, { timeout: timeoutMs, signal });
  const decoded = await decodeGeotiffToFloatGrid(arrayBuffer);

  return {
    ...decoded,
    meta: {
      provider: "HTTP_GEOTIFF",
      dataProduct: "HTTP_GEOTIFF_DSM",
      source: urlTemplate,
      fetchedAt: new Date().toISOString(),
      tileZ: z,
      tileX: x,
      tileY: y,
    },
  };
}

/**
 * CP-FAR-009 — Grille DSM pour rayon donné (zoom adaptatif)
 * Pour radiusMeters > 2000, utilise z=13 pour couvrir ~5km.
 */
export async function getDsmGridForRadius(params) {
  const { lat, lon, radiusMeters = 4000, resolutionMeters = 10, signal } = params;
  const z = radiusMeters > 2000 ? 13 : 15;
  return getTileHeights({
    lat,
    lon,
    radiusMeters,
    resolutionMeters,
    signal,
    _zoomOverride: z,
  });
}

