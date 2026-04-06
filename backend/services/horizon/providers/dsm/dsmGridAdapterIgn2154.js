/**
 * CP-FAR-IGN-03 — Adaptateur grille locale IGN (EPSG:2154) vers format dsmGridToHorizonMask.
 * Convertit origin (x0,y0) bottom-left Lambert93 en origin NW WGS84 et retourne grille row-0 = top.
 */

import { lambert93ToWgs84 } from "../ign/projection2154.js";

/**
 * @param {Object} localGrid2154 - sortie de buildLocalGrid2154
 * @param {Float32Array} localGrid2154.grid
 * @param {number} localGrid2154.width
 * @param {number} localGrid2154.height
 * @param {{ x0: number, y0: number }} localGrid2154.origin
 * @param {number} localGrid2154.stepMeters
 * @param {number} localGrid2154.noDataValue
 * @returns {{ grid: Float32Array, width: number, height: number, origin: { lat: number, lon: number }, stepMeters: number, noDataValue: number }}
 */
export function localGrid2154ToDsmResult(localGrid2154) {
  const { grid, width, height, origin, stepMeters, noDataValue } = localGrid2154;
  const { x0, y0 } = origin;
  const yTop = y0 + height * stepMeters;
  const { lat, lon } = lambert93ToWgs84({ x: x0, y: yTop });
  const originNW = { lat, lon };

  const gridFlipped = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const srcRow = height - 1 - row;
    for (let col = 0; col < width; col++) {
      const v = grid[srcRow * width + col];
      gridFlipped[row * width + col] = v === noDataValue || v !== v ? noDataValue : v;
    }
  }

  return {
    grid: gridFlipped,
    width,
    height,
    origin: originNW,
    stepMeters,
    noDataValue,
  };
}
