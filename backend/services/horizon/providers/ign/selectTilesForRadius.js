/**
 * CP-FAR-IGN-02 — Sélection des dalles IGN intersectant un carré [x±r, y±r] (Lambert93).
 */

/**
 * @param {{ x: number, y: number }} center - centre en mètres Lambert93
 * @param {number} radius_m - rayon en mètres
 * @param {{ tiles: Array<{ pathRel: string, bboxLambert93: { minX, minY, maxX, maxY } }> }} tilesIndex - index avec tiles[].bboxLambert93
 * @returns {Array<{ pathRel: string, bboxLambert93: object }>} dalles dont la bbox intersecte le carré
 * @throws si 0 tile couvre le site
 */
export function selectTilesForRadius(center, radius_m, tilesIndex) {
  const { x, y } = center;
  const minX = x - radius_m;
  const maxX = x + radius_m;
  const minY = y - radius_m;
  const maxY = y + radius_m;

  const tiles = tilesIndex.tiles || [];
  const selected = tiles.filter((t) => {
    const b = t.bboxLambert93;
    if (!b || b.minX == null) return false;
    const interX = b.minX < maxX && b.maxX > minX;
    const interY = b.minY < maxY && b.maxY > minY;
    return interX && interY;
  });

  if (selected.length === 0) {
    throw new Error(
      `No IGN tiles covering site (Lambert93 x=${x.toFixed(0)}, y=${y.toFixed(0)}, radius_m=${radius_m})`
    );
  }

  return selected;
}
