/**
 * CP-FAR-IGN-02 — Grille locale DSM autour d'un point (Lambert93), remplie via sampler.
 */

/**
 * @param {{ centerX: number, centerY: number, radius_m: number, desiredRes_m: number }} params
 * @param {(x: number, y: number) => Promise<number | null>} sampleHeightAtXY - sampler async
 * @returns {Promise<{ crs: string, width: number, height: number, origin: { x0: number, y0: number }, stepMeters: number, noDataValue: number, grid: Float32Array }>}
 */
export async function buildLocalGrid2154(params, sampleHeightAtXY) {
  const { centerX, centerY, radius_m, desiredRes_m } = params;
  const noDataValue = -9999;

  const half = radius_m;
  const x0 = centerX - half;
  const y0 = centerY - half;
  const sizeM = 2 * half;
  const width = Math.max(1, Math.round(sizeM / desiredRes_m));
  const height = Math.max(1, Math.round(sizeM / desiredRes_m));
  const stepMeters = sizeM / Math.max(width, height);

  const grid = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = x0 + (col + 0.5) * stepMeters;
      const y = y0 + (row + 0.5) * stepMeters;
      const z = await sampleHeightAtXY(x, y);
      const idx = row * width + col;
      grid[idx] = z != null ? z : noDataValue;
    }
  }

  return {
    crs: "EPSG:2154",
    width,
    height,
    origin: { x0, y0 },
    stepMeters,
    noDataValue,
    grid,
  };
}
