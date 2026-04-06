/**
 * Palette premium sobre (pas heatmap scientifique) — interpolation douce sur qualityScore01 ∈ [0,1].
 */

import * as THREE from "three";

const EXCELLENT = "#d6c28a";
const MID = "#b88c45";
const POOR = "#7a4e2e";
const POOR_DEEP = "#5c3d24";
const NEUTRAL = "#6b7280";

function lerpHex(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ar = (ca >> 16) & 255;
  const ag = (ca >> 8) & 255;
  const ab = ca & 255;
  const br = (cb >> 16) & 255;
  const bg = (cb >> 8) & 255;
  const bb = cb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b2 = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b2).toString(16).slice(1)}`;
}

/**
 * Teinte « accent » pour modulation sur une base PV sombre (Three.js).
 * `score` null → neutre premium.
 */
export function premiumTintHexForQualityScore(score01: number | null): string {
  if (score01 == null || !Number.isFinite(score01)) return NEUTRAL;
  const s = Math.max(0, Math.min(1, score01));
  if (s >= 0.72) {
    const t = (s - 0.72) / (1 - 0.72);
    return lerpHex(MID, EXCELLENT, t);
  }
  if (s >= 0.45) {
    const t = (s - 0.45) / (0.72 - 0.45);
    return lerpHex(POOR, MID, t);
  }
  const t = s / 0.45;
  return lerpHex(POOR_DEEP, POOR, t);
}

/** Base module photovoltaïque (sombre, crédible). */
export const PV_BASE_SURFACE_HEX = "#1a222c";

export function blendPvSurfaceColor(tintHex: string, strength = 0.42): number {
  const base = new THREE.Color(PV_BASE_SURFACE_HEX);
  const tint = new THREE.Color(tintHex);
  base.lerp(tint, strength);
  return base.getHex();
}
