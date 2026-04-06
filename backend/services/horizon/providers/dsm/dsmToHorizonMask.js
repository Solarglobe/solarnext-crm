/**
 * CP-FAR-008 — Adaptateur grille DSM → horizon mask
 * Convertit une grille Float32Array (altitudes en m) en masque d'horizon { az, elev }[].
 * Origin NW (coin haut-gauche), stepMeters par pixel.
 * elevDeg = atan2(zObstacle - zRef, distanceHorizontal) en degrés.
 */

const M_PER_DEG_LAT = 111320;
const DEBUG = process.env.HORIZON_DSM_DEBUG === "1";

/**
 * Convertit (lat, lon) en coordonnées pixel dans la grille.
 * @param {number} lat
 * @param {number} lon
 * @param {{ lat: number, lon: number }} origin - coin NW
 * @param {number} stepMeters
 */
function latLonToPixel(lat, lon, origin, stepMeters) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  const dx = (lon - origin.lon) * mPerDegLon;
  const dy = (origin.lat - lat) * M_PER_DEG_LAT;
  const px = dx / stepMeters;
  const py = dy / stepMeters;
  return { px, py };
}

/**
 * Échantillonne la grille en (px, py) avec interpolation bilinéaire.
 * @param {Float32Array} grid
 * @param {number} width
 * @param {number} height
 * @param {number} px
 * @param {number} py
 * @param {number} noDataValue
 */
function sampleGrid(grid, width, height, px, py, noDataValue) {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  if (x0 < 0 || x0 >= width - 1 || y0 < 0 || y0 >= height - 1) {
    return NaN;
  }
  const idx = (y0 * width + x0);
  const v00 = grid[idx];
  const v10 = grid[idx + 1];
  const v01 = grid[idx + width];
  const v11 = grid[idx + width + 1];

  const isNoData = (v) => (noDataValue != null && !isNaN(noDataValue) && v === noDataValue) || isNaN(v);
  if (isNoData(v00) && isNoData(v10) && isNoData(v01) && isNoData(v11)) return NaN;

  const tx = px - x0;
  const ty = py - y0;
  const a = isNoData(v00) ? 0 : v00;
  const b = isNoData(v10) ? 0 : v10;
  const c = isNoData(v01) ? 0 : v01;
  const d = isNoData(v11) ? 0 : v11;
  return (1 - tx) * (1 - ty) * a + tx * (1 - ty) * b + (1 - tx) * ty * c + tx * ty * d;
}

/**
 * @param {Object} dsmResult
 * @param {Float32Array} dsmResult.grid
 * @param {number} dsmResult.width
 * @param {number} dsmResult.height
 * @param {{ lat: number, lon: number }} dsmResult.origin
 * @param {number} dsmResult.stepMeters
 * @param {number} [dsmResult.noDataValue]
 * @param {number} observerLat
 * @param {number} observerLon
 * @param {number} radiusMeters
 * @param {number} stepDeg
 * @returns {{ mask: Array<{az: number, elev: number}> }}
 */
export function dsmGridToHorizonMask(dsmResult, observerLat, observerLon, radiusMeters, stepDeg) {
  const { grid, width, height, origin, stepMeters, noDataValue } = dsmResult;

  const obsPixel = latLonToPixel(observerLat, observerLon, origin, stepMeters);
  const observerHeight = sampleGrid(grid, width, height, obsPixel.px, obsPixel.py, noDataValue);
  const h0 = isNaN(observerHeight) ? 0 : observerHeight;

  if (DEBUG) {
    console.log("[DSM:HorizonMask] lat=", observerLat, "lon=", observerLon, "radius=", radiusMeters, "stepDeg=", stepDeg);
    console.log("[DSM:HorizonMask] zRef=", h0, "obsPixel=", obsPixel.px?.toFixed(2), obsPixel.py?.toFixed(2));
  }

  const mPerDegLon = M_PER_DEG_LAT * Math.cos((observerLat * Math.PI) / 180);
  const numBins = Math.round(360 / stepDeg);
  const mask = [];
  let noDataCount = 0;
  let sampleCount = 0;

  for (let i = 0; i < numBins; i++) {
    const azDeg = (i * stepDeg) % 360;
    const azRad = (azDeg * Math.PI) / 180;

    let maxElevDeg = 0;
    const stepDist = Math.max(stepMeters / 2, 10);
    for (let d = stepDist; d <= radiusMeters; d += stepDist) {
      const dLat = (-Math.cos(azRad) * d) / M_PER_DEG_LAT;
      const dLon = (Math.sin(azRad) * d) / mPerDegLon;
      const sampleLat = observerLat + dLat;
      const sampleLon = observerLon + dLon;

      const pix = latLonToPixel(sampleLat, sampleLon, origin, stepMeters);
      const h = sampleGrid(grid, width, height, pix.px, pix.py, noDataValue);
      sampleCount++;
      if (isNaN(h)) {
        noDataCount++;
        continue;
      }

      const heightDiff = h - h0;
      const elevRad = Math.atan2(heightDiff, d);
      const elevDeg = (elevRad * 180) / Math.PI;
      if (elevDeg > maxElevDeg) maxElevDeg = elevDeg;
    }

    mask.push({ az: azDeg, elev: Math.max(0, Math.min(90, maxElevDeg)) });
  }

  if (DEBUG) {
    const ptsAbove0 = mask.filter((m) => (m.elev ?? 0) > 0).length;
    console.log("[DSM:HorizonMask] sampleCount=", sampleCount, "noDataCount=", noDataCount, "noDataRatio=", (noDataCount / sampleCount).toFixed(2));
    console.log("[DSM:HorizonMask] minElev=", Math.min(...mask.map((m) => m.elev ?? 0)).toFixed(2), "maxElev=", Math.max(...mask.map((m) => m.elev ?? 0)).toFixed(2), "pts>0=", ptsAbove0);
  }

  return { mask };
}
