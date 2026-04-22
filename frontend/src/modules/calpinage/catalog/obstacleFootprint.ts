/**
 * Aire d’emprise obstacle au sol (m²) pour heuristiques métier.
 * Niveau 3 : polygone via `polygonHorizontalAreaM2FromImagePx` ; rectangle via côtés monde officiels.
 */

import {
  polygonHorizontalAreaM2FromImagePx,
  segmentHorizontalLengthMFromImagePx,
} from "../canonical3d/builder/worldMapping";

export function computeObstacleFootprintAreaM2(
  obstacle: {
    points?: { x: number; y: number }[];
    shapeMeta?: { originalType?: string; width?: number; height?: number; radius?: number };
  },
  metersPerPixel: number,
  northAngleDeg: number = 0,
): number {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const north = Number.isFinite(northAngleDeg) ? northAngleDeg : 0;
  const sm = obstacle.shapeMeta;
  if (sm?.originalType === "rect" && typeof sm.width === "number" && typeof sm.height === "number") {
    const wM = segmentHorizontalLengthMFromImagePx({ x: 0, y: 0 }, { x: sm.width, y: 0 }, mpp, north);
    const hM = segmentHorizontalLengthMFromImagePx({ x: 0, y: 0 }, { x: 0, y: sm.height }, mpp, north);
    return Math.abs(wM * hM);
  }
  if (sm?.originalType === "circle" && typeof sm.radius === "number") {
    const r = Math.abs(sm.radius) * mpp;
    return Math.PI * r * r;
  }
  const pts = obstacle.points;
  if (pts && pts.length >= 3) {
    return polygonHorizontalAreaM2FromImagePx(pts, mpp, north);
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
