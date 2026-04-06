/**
 * CP-FAR-IGN-02 — Sampler altitude continu en EPSG:2154 (Lambert93).
 * (x,y) -> z (m), avec interpolation bilinéaire et fallback NODATA sur voisinage.
 */

/**
 * Interpolation bilinéaire dans une grille (origine bas-gauche, row 0 = bas).
 * (x,y) en mètres -> (col, row) en indices.
 */
function sampleBilinear(grid, width, height, x0, y0, cellsize_m, x, y, noDataValue) {
  const col = (x - x0) / cellsize_m;
  const row = (y - y0) / cellsize_m;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  if (c0 < 0 || c0 >= width - 1 || r0 < 0 || r0 >= height - 1) return null;
  const tc = col - c0;
  const tr = row - r0;
  const idx = (r0 * width + c0);
  const v00 = grid[idx];
  const v10 = grid[idx + 1];
  const v01 = grid[idx + width];
  const v11 = grid[idx + width + 1];

  const isNoData = (v) => (noDataValue != null && v === noDataValue) || v !== v;
  if (isNoData(v00) && isNoData(v10) && isNoData(v01) && isNoData(v11)) return null;
  const a = isNoData(v00) ? 0 : v00;
  const b = isNoData(v10) ? 0 : v10;
  const c = isNoData(v01) ? 0 : v01;
  const d = isNoData(v11) ? 0 : v11;
  const z = (1 - tc) * (1 - tr) * a + tc * (1 - tr) * b + (1 - tc) * tr * c + tc * tr * d;
  return z;
}

/**
 * Cherche une valeur valide dans un petit voisinage (rayon en nombre de cellules).
 */
function fallbackNeighborhood(grid, width, height, x0, y0, cellsize_m, x, y, noDataValue, radiusCells = 2) {
  const col = (x - x0) / cellsize_m;
  const row = (y - y0) / cellsize_m;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  for (let dr = -radiusCells; dr <= radiusCells; dr++) {
    for (let dc = -radiusCells; dc <= radiusCells; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || c >= width || r < 0 || r >= height) continue;
      const v = grid[r * width + c];
      if (v !== v) continue;
      if (noDataValue != null && v === noDataValue) continue;
      return v;
    }
  }
  return null;
}

/**
 * @param {{ tilesIndex: { tiles: Array<{ pathRel: string, bboxLambert93: object }> }, tileLoader: { loadTile: (pathRel: string) => Promise<object> } }} opts
 * @returns {(x: number, y: number) => Promise<number | null>} sampleHeightAtXY en mètres, null si NODATA / hors dalles
 */
export function createIgnHeightSampler({ tilesIndex, tileLoader }) {
  const tiles = tilesIndex.tiles || [];

  return async function sampleHeightAtXY(x, y) {
    const tile = tiles.find((t) => {
      const b = t.bboxLambert93;
      return x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY;
    });
    if (!tile) return null;

    const meta = await tileLoader.loadTile(tile.pathRel);
    if (!meta) return null;
    const { grid, width, height, x0, y0, cellsize_m, noDataValue } = meta;

    let z = sampleBilinear(grid, width, height, x0, y0, cellsize_m, x, y, noDataValue);
    if (z != null) return z;
    z = fallbackNeighborhood(grid, width, height, x0, y0, cellsize_m, x, y, noDataValue, 2);
    return z ?? null;
  };
}
