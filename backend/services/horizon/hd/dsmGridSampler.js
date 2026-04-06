/**
 * CP-FAR-009 — Sampler DSM grille avec interpolation bilinéaire
 * Réutilisable pour heightAt(lat, lon).
 */

const M_PER_DEG_LAT = 111320;

/**
 * @param {Object} dsmGrid
 * @param {Float32Array} dsmGrid.grid
 * @param {number} dsmGrid.width
 * @param {number} dsmGrid.height
 * @param {{ lat: number, lon: number }} dsmGrid.origin - coin NW
 * @param {number} dsmGrid.stepMeters
 * @param {number} [dsmGrid.noDataValue]
 * @returns {(lat: number, lon: number) => number}
 */
export function createDsmGridSampler(dsmGrid) {
  const { grid, width, height, origin, stepMeters, noDataValue } = dsmGrid;

  function latLonToPixel(lat, lon) {
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
    const dx = (lon - origin.lon) * mPerDegLon;
    const dy = (origin.lat - lat) * M_PER_DEG_LAT;
    const px = dx / stepMeters;
    const py = dy / stepMeters;
    return { px, py };
  }

  function sample(px, py) {
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    if (x0 < 0 || x0 >= width - 1 || y0 < 0 || y0 >= height - 1) {
      return NaN;
    }
    const idx = y0 * width + x0;
    const v00 = grid[idx];
    const v10 = grid[idx + 1];
    const v01 = grid[idx + width];
    const v11 = grid[idx + width + 1];

    const isNoData = (v) =>
      (noDataValue != null && !isNaN(noDataValue) && v === noDataValue) || isNaN(v);
    if (isNoData(v00) && isNoData(v10) && isNoData(v01) && isNoData(v11)) return NaN;

    const tx = px - x0;
    const ty = py - y0;
    const a = isNoData(v00) ? 0 : v00;
    const b = isNoData(v10) ? 0 : v10;
    const c = isNoData(v01) ? 0 : v01;
    const d = isNoData(v11) ? 0 : v11;
    return (1 - tx) * (1 - ty) * a + tx * (1 - ty) * b + (1 - tx) * ty * c + tx * ty * d;
  }

  return function sampleHeight(lat, lon) {
    const { px, py } = latLonToPixel(lat, lon);
    return sample(px, py);
  };
}

/**
 * z0 avec fallback moyenne 3x3 autour du site.
 * @param {(lat: number, lon: number) => number} sampler
 * @param {number} siteLat
 * @param {number} siteLon
 * @param {number} stepMeters
 * @returns {number}
 */
export function getSiteElevation(sampler, siteLat, siteLon, stepMeters) {
  const M_PER_DEG_LAT = 111320;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((siteLat * Math.PI) / 180);
  const dLat = (stepMeters * 1.5) / M_PER_DEG_LAT;
  const dLon = (stepMeters * 1.5) / mPerDegLon;

  let sum = 0;
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const z = sampler(siteLat + dy * dLat, siteLon + dx * dLon);
      if (typeof z === "number" && !isNaN(z)) {
        sum += z;
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}
