/**
 * CP-FAR-IGN-01 — Parser Esri ASCII Grid (RGE ALTI IGN).
 * Header: ncols, nrows, xllcorner/xllcenter, yllcorner/yllcenter, cellsize, NODATA_value.
 * Origine retournée en mètres (Lambert-93) : bas-gauche (x0, y0).
 */

import fs from "fs";

const DEFAULT_NODATA = -9999;

/**
 * Parse un fichier .asc (Esri ASCII Raster).
 * @param {string} filePath - chemin vers le .asc
 * @returns {{
 *   width: number,
 *   height: number,
 *   x0: number,
 *   y0: number,
 *   cellsize_m: number,
 *   noDataValue: number,
 *   grid: Float32Array
 * }}
 */
export function parseEsriAsciiGrid(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).map((l) => l.trim());

  let ncols = 0,
    nrows = 0,
    xllcorner,
    yllcorner,
    xllcenter,
    yllcenter,
    cellsize = 1,
    nodata = DEFAULT_NODATA;
  let dataStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.length) continue;
    const key = line.split(/\s+/)[0].toLowerCase();
    const rest = line.slice(line.indexOf(key) + key.length).trim().split(/\s+/);
    const val = rest[0] != null ? parseFloat(rest[0]) : NaN;

    if (key === "ncols") ncols = parseInt(rest[0], 10);
    else if (key === "nrows") nrows = parseInt(rest[0], 10);
    else if (key === "xllcorner") xllcorner = val;
    else if (key === "yllcorner") yllcorner = val;
    else if (key === "xllcenter") xllcenter = val;
    else if (key === "yllcenter") yllcenter = val;
    else if (key === "cellsize") cellsize = val;
    else if (key === "nodata_value" || key === "nodata") nodata = val;
    else if (/^-?[\d.]/.test(line)) {
      dataStart = i;
      break;
    }
  }

  const x0 = xllcorner != null ? xllcorner : xllcenter != null ? xllcenter - cellsize / 2 : 0;
  const y0 = yllcorner != null ? yllcorner : yllcenter != null ? yllcenter - cellsize / 2 : 0;

  const grid = new Float32Array(ncols * nrows);
  let idx = 0;
  for (let i = dataStart; i < lines.length && idx < ncols * nrows; i++) {
    const parts = lines[i].split(/\s+/).filter(Boolean);
    for (const p of parts) {
      const v = parseFloat(p);
      grid[idx++] = v === nodata || isNaN(v) ? NaN : v;
    }
  }

  return {
    width: ncols,
    height: nrows,
    x0,
    y0,
    cellsize_m: cellsize,
    noDataValue: nodata,
    grid,
  };
}

const DEFAULT_NODATA_HEADER = -9999;

/**
 * Lit uniquement l'en-tête d'un .asc pour obtenir l'emprise (Lambert-93) + noDataValue.
 * @param {string} filePath
 * @returns {{ x0: number, y0: number, x1: number, y1: number, width: number, height: number, cellsize_m: number, noDataValue: number }}
 */
export function parseEsriAsciiGridHeader(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).map((l) => l.trim());

  let ncols = 0, nrows = 0, xllcorner, yllcorner, xllcenter, yllcenter, cellsize = 1, nodata = DEFAULT_NODATA_HEADER;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i];
    if (!line.length) continue;
    const key = line.split(/\s+/)[0].toLowerCase();
    const rest = line.slice(line.indexOf(key) + key.length).trim().split(/\s+/);
    const val = rest[0] != null ? parseFloat(rest[0]) : NaN;
    if (key === "ncols") ncols = parseInt(rest[0], 10);
    else if (key === "nrows") nrows = parseInt(rest[0], 10);
    else if (key === "xllcorner") xllcorner = val;
    else if (key === "yllcorner") yllcorner = val;
    else if (key === "xllcenter") xllcenter = val;
    else if (key === "yllcenter") yllcenter = val;
    else if (key === "cellsize") cellsize = val;
    else if (key === "nodata_value" || key === "nodata") nodata = val;
    else if (/^-?[\d.]/.test(line)) break;
  }
  const x0 = xllcorner != null ? xllcorner : (xllcenter != null ? xllcenter - cellsize / 2 : 0);
  const y0 = yllcorner != null ? yllcorner : (yllcenter != null ? yllcenter - cellsize / 2 : 0);
  const x1 = x0 + ncols * cellsize;
  const y1 = y0 + nrows * cellsize;
  return { x0, y0, x1, y1, width: ncols, height: nrows, cellsize_m: cellsize, noDataValue: nodata };
}
