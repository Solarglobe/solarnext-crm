/**
 * Aire d’emprise obstacle au sol (m²) pour heuristiques métier.
 */

export function computeObstacleFootprintAreaM2(
  obstacle: {
    points?: { x: number; y: number }[];
    shapeMeta?: { originalType?: string; width?: number; height?: number; radius?: number };
  },
  metersPerPixel: number
): number {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const sm = obstacle.shapeMeta;
  if (sm?.originalType === "rect" && typeof sm.width === "number" && typeof sm.height === "number") {
    return Math.abs(sm.width * mpp) * Math.abs(sm.height * mpp);
  }
  if (sm?.originalType === "circle" && typeof sm.radius === "number") {
    const r = Math.abs(sm.radius) * mpp;
    return Math.PI * r * r;
  }
  const pts = obstacle.points;
  if (pts && pts.length >= 3) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a / 2) * mpp * mpp;
  }
  return 0.01;
}

export function computeShadowVolumeFootprintAreaM2(
  vol: { shape?: string; width?: number; depth?: number },
  _metersPerPixel: number
): number {
  const w = typeof vol.width === "number" && vol.width > 0 ? vol.width : 0.6;
  const d = typeof vol.depth === "number" && vol.depth > 0 ? vol.depth : 0.6;
  if (vol.shape === "tube") {
    const r = w / 2;
    return Math.PI * r * r;
  }
  return w * d;
}
