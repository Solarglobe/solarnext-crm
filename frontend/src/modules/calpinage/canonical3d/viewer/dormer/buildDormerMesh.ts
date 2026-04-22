/**
 * Construction **pure** d’un maillage lucarne / chien assis (pignon simple).
 * Aucune mutation d’état calpinage — uniquement géométrie Three.js.
 */

import * as THREE from "three";
import { imagePxToWorldHorizontalM } from "../../builder/worldMapping";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { sampleRoofZAtImagePxFromPatches } from "./sampleRoofZAtImagePxFromPatches";

/** Audit runtime temporaire — `window.__CALPINAGE_DORMER_AUDIT__ === true` uniquement. */
function dormerAuditLog(msg: string, detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __CALPINAGE_DORMER_AUDIT__?: boolean };
  if (w.__CALPINAGE_DORMER_AUDIT__ !== true) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log("[DORMER_AUDIT]", msg, detail);
  } else {
    console.log("[DORMER_AUDIT]", msg);
  }
}

export type DormerRoofModelForMesh = {
  readonly world: CanonicalWorldConfig;
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
};

export type DormerRuntimeExtensionInput = {
  /** Legacy : `"roof_extension"` ; visuel dormer si `kind === "dormer"`. */
  readonly type?: string;
  readonly kind?: string;
  readonly dormerType?: string;
  readonly depthM?: number;
  readonly wallHeightM?: number;
  readonly ridgeHeightRelM?: number;
  readonly ridge?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
  readonly contour?: {
    readonly closed?: boolean;
    readonly points?: ReadonlyArray<{ readonly x?: number; readonly y?: number }>;
  };
};

function finiteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function distPointToLine2d(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

function pushTri(
  positions: number[],
  indices: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): void {
  const base = positions.length / 3;
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  indices.push(base, base + 1, base + 2);
}

function pushQuad(
  positions: number[],
  indices: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
): void {
  pushTri(positions, indices, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  pushTri(positions, indices, a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
}

/**
 * @returns géométrie triangulée ou `null` si données insuffisantes / type non supporté (repli viewer : ancien prismatique).
 */
export function buildDormerMesh(ext: DormerRuntimeExtensionInput, roofModel: DormerRoofModelForMesh): THREE.BufferGeometry | null {
  if (ext.kind != null && ext.kind !== "dormer") {
    dormerAuditLog("GUARD: kind reject", { kind: ext.kind });
    return null;
  }
  if (ext.type != null && ext.type !== "dormer" && ext.type !== "roof_extension") {
    dormerAuditLog("GUARD: type reject", { type: ext.type });
    return null;
  }
  if (ext.dormerType != null && ext.dormerType !== "gable") {
    dormerAuditLog("GUARD: dormerType reject", { dormerType: ext.dormerType });
    return null;
  }

  const ra = ext.ridge?.a;
  const rb = ext.ridge?.b;
  if (!ra || !rb || !finiteNum(ra.x) || !finiteNum(ra.y) || !finiteNum(rb.x) || !finiteNum(rb.y)) {
    dormerAuditLog("GUARD: ridge invalid", { hasRa: !!ra, hasRb: !!rb });
    return null;
  }

  const ridgeH = ext.ridgeHeightRelM;
  if (!finiteNum(ridgeH) || ridgeH <= 0.02) {
    dormerAuditLog("GUARD: ridgeHeightRelM invalid", { ridgeHeightRelM: ridgeH });
    return null;
  }

  const ptsIn = ext.contour?.points;
  if (!ptsIn || ptsIn.length < 3) {
    dormerAuditLog("GUARD: contour invalid (points length)", { contourPointsLen: ptsIn?.length ?? 0 });
    return null;
  }
  const ring: { x: number; y: number }[] = [];
  for (const p of ptsIn) {
    if (p && finiteNum(p.x) && finiteNum(p.y)) ring.push({ x: p.x, y: p.y });
  }
  if (ring.length < 3) {
    dormerAuditLog("GUARD: contour invalid (finite points < 3)", { finitePoints: ring.length });
    return null;
  }
  if (ring.length > 1) {
    const a0 = ring[0]!;
    const a1 = ring[ring.length - 1]!;
    if (Math.hypot(a0.x - a1.x, a0.y - a1.y) < 1e-6) ring.pop();
  }
  if (ring.length < 3) {
    dormerAuditLog("GUARD: contour invalid (after duplicate close)", { ringLen: ring.length });
    return null;
  }

  const { world, roofPlanePatches } = roofModel;
  const mpp = world.metersPerPixel;
  const north = world.northAngleDeg;
  if (!finiteNum(mpp) || mpp <= 0) {
    dormerAuditLog("GUARD: metersPerPixel invalid", { mpp });
    return null;
  }

  const sampleZ = (xPx: number, yPx: number): number | null =>
    sampleRoofZAtImagePxFromPatches(xPx, yPx, roofPlanePatches, world);

  let bestI = -1;
  let bestD = -1;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p0 = ring[i]!;
    const p1 = ring[(i + 1) % n]!;
    const mx = (p0.x + p1.x) * 0.5;
    const my = (p0.y + p1.y) * 0.5;
    const d = distPointToLine2d(mx, my, ra.x, ra.y, rb.x, rb.y);
    if (d > bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (bestI < 0 || bestD < 1e-6) {
    dormerAuditLog("GUARD: back edge invalid (ridge alignment / bestD)", { bestI, bestD });
    return null;
  }

  const F0i = ring[bestI]!;
  const F1i = ring[(bestI + 1) % n]!;

  const zF0 = sampleZ(F0i.x, F0i.y);
  const zF1 = sampleZ(F1i.x, F1i.y);
  const zR0b = sampleZ(ra.x, ra.y);
  const zR1b = sampleZ(rb.x, rb.y);
  if (zF0 == null || zF1 == null || zR0b == null || zR1b == null) {
    dormerAuditLog("GUARD: sampleRoofZ null", {
      zF0: zF0 === null ? "null" : zF0,
      zF1: zF1 === null ? "null" : zF1,
      zR0b: zR0b === null ? "null" : zR0b,
      zR1b: zR1b === null ? "null" : zR1b,
    });
    return null;
  }

  const wF0 = imagePxToWorldHorizontalM(F0i.x, F0i.y, mpp, north);
  const wF1 = imagePxToWorldHorizontalM(F1i.x, F1i.y, mpp, north);
  const wR0 = imagePxToWorldHorizontalM(ra.x, ra.y, mpp, north);
  const wR1 = imagePxToWorldHorizontalM(rb.x, rb.y, mpp, north);

  const zR0 = zR0b + ridgeH;
  const zR1 = zR1b + ridgeH;

  const depthGuess =
    ext.depthM != null && finiteNum(ext.depthM) && ext.depthM > 0
      ? ext.depthM
      : Math.max(0.3, bestD * mpp);

  const wallH =
    ext.wallHeightM != null && finiteNum(ext.wallHeightM) && ext.wallHeightM > 0
      ? ext.wallHeightM
      : Math.max(0.25, Math.min(ridgeH * 0.55, depthGuess * 0.45));

  const F0b: [number, number, number] = [wF0.x, wF0.y, zF0];
  const F1b: [number, number, number] = [wF1.x, wF1.y, zF1];
  const F0t: [number, number, number] = [wF0.x, wF0.y, zF0 + wallH];
  const F1t: [number, number, number] = [wF1.x, wF1.y, zF1 + wallH];
  const R0b: [number, number, number] = [wR0.x, wR0.y, zR0b];
  const R1b: [number, number, number] = [wR1.x, wR1.y, zR1b];
  const R0t: [number, number, number] = [wR0.x, wR0.y, zR0];
  const R1t: [number, number, number] = [wR1.x, wR1.y, zR1];

  const positions: number[] = [];
  const indices: number[] = [];

  pushQuad(positions, indices, F0b, F1b, F1t, F0t);
  pushQuad(positions, indices, F0b, F0t, R0t, R0b);
  pushQuad(positions, indices, F1b, F1t, R1t, R1b);
  pushQuad(positions, indices, R0b, R1b, R1t, R0t);
  pushTri(positions, indices, F0t[0], F0t[1], F0t[2], R0t[0], R0t[1], R0t[2], R1t[0], R1t[1], R1t[2]);
  pushTri(positions, indices, F1t[0], F1t[1], F1t[2], R1t[0], R1t[1], R1t[2], R0t[0], R0t[1], R0t[2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  dormerAuditLog("RESULT: geometry", { positionCount: posAttr?.count ?? 0 });
  return geo;
}

/** Arêtes pour `lineSegments` (debug `window.__CALPINAGE_DORMER_DEBUG__`). */
export function buildDormerEdgesGeometry(meshGeo: THREE.BufferGeometry): THREE.BufferGeometry | null {
  try {
    return new THREE.EdgesGeometry(meshGeo, 30);
  } catch {
    return null;
  }
}
