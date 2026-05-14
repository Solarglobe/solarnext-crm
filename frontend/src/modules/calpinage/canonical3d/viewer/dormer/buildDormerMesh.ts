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
  readonly hips?: {
    readonly left?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
    readonly right?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
  };
  readonly contour?: {
    readonly closed?: boolean;
    readonly points?: ReadonlyArray<{ readonly x?: number; readonly y?: number }>;
  };
};

function finiteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
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

function dist2d(a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestRingIndex(ring: readonly { readonly x: number; readonly y: number }[], p: { readonly x: number; readonly y: number }): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = dist2d(ring[i]!, p);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function ringPathIndices(from: number, to: number, count: number, clockwise: boolean): number[] {
  const out: number[] = [];
  let i = from;
  for (let guard = 0; guard <= count; guard++) {
    out.push(i);
    if (i === to) break;
    i = clockwise ? (i + 1) % count : (i - 1 + count) % count;
  }
  return out;
}

function polygonArea2d(pts: readonly { readonly x: number; readonly y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
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

  const ridgeHRaw = ext.ridgeHeightRelM;
  if (!finiteNum(ridgeHRaw) || ridgeHRaw <= 0.02) {
    dormerAuditLog("GUARD: ridgeHeightRelM invalid", { ridgeHeightRelM: ridgeHRaw });
    return null;
  }
  const ridgeH = Math.max(0.35, Math.min(1.0, ridgeHRaw));

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

  const wR0 = imagePxToWorldHorizontalM(ra.x, ra.y, mpp, north);
  const wR1 = imagePxToWorldHorizontalM(rb.x, rb.y, mpp, north);

  const baseRing: [number, number, number][] = [];
  for (const p of ring) {
    const z = sampleZ(p.x, p.y);
    if (z == null) {
      dormerAuditLog("GUARD: sampleRoofZ null on contour", { x: p.x, y: p.y });
      return null;
    }
    const w = imagePxToWorldHorizontalM(p.x, p.y, mpp, north);
    baseRing.push([w.x, w.y, z]);
  }

  const n = baseRing.length;
  let cx = 0;
  let cy = 0;
  for (const p of baseRing) {
    cx += p[0];
    cy += p[1];
  }
  cx /= n;
  cy /= n;

  let ux = wR1.x - wR0.x;
  let uy = wR1.y - wR0.y;
  let uLen = Math.hypot(ux, uy);
  if (uLen < 1e-6) {
    let bestLen = 0;
    for (let i = 0; i < n; i++) {
      const a = baseRing[i]!;
      const b = baseRing[(i + 1) % n]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len > bestLen) {
        bestLen = len;
        ux = dx;
        uy = dy;
      }
    }
    uLen = Math.hypot(ux, uy);
  }
  if (uLen < 1e-6) {
    dormerAuditLog("GUARD: dormer orientation invalid");
    return null;
  }
  ux /= uLen;
  uy /= uLen;
  const vx = -uy;
  const vy = ux;

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of baseRing) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const u = dx * ux + dy * uy;
    const v = dx * vx + dy * vy;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const halfLength = Math.max(0.35, (maxU - minU) * 0.5);
  const halfDepth = Math.max(0.25, (maxV - minV) * 0.5);
  const depthGuess = ext.depthM != null && finiteNum(ext.depthM) && ext.depthM > 0 ? ext.depthM : halfDepth * 2;

  const wallH =
    ext.wallHeightM != null && finiteNum(ext.wallHeightM) && ext.wallHeightM > 0
      ? ext.wallHeightM
      : Math.max(0.18, Math.min(ridgeH * 0.42, depthGuess * 0.32));

  const nearestBaseZ = (x: number, y: number): number => {
    let best = baseRing[0]!;
    let bestD = Infinity;
    for (const p of baseRing) {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best[2];
  };
  const pointAt = (u: number, v: number): [number, number, number] => {
    const x = cx + ux * u + vx * v;
    const y = cy + uy * u + vy * v;
    return [x, y, nearestBaseZ(x, y)];
  };
  const baseAuto: [number, number, number][] = [
    pointAt(-halfLength, -halfDepth),
    pointAt(halfLength, -halfDepth),
    pointAt(halfLength, halfDepth),
    pointAt(-halfLength, halfDepth),
  ];
  const eaveAuto: [number, number, number][] = baseAuto.map((p) => [p[0], p[1], p[2] + wallH]);
  const zRidgeBase = (baseAuto[0]![2] + baseAuto[1]![2] + baseAuto[2]![2] + baseAuto[3]![2]) * 0.25;
  const ridgeHalfLength = Math.max(0.22, halfLength * 0.78);
  const R0t: [number, number, number] = [cx - ux * ridgeHalfLength, cy - uy * ridgeHalfLength, zRidgeBase + ridgeH];
  const R1t: [number, number, number] = [cx + ux * ridgeHalfLength, cy + uy * ridgeHalfLength, zRidgeBase + ridgeH];

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < 4; i++) {
    pushQuad(positions, indices, baseAuto[i]!, baseAuto[(i + 1) % 4]!, eaveAuto[(i + 1) % 4]!, eaveAuto[i]!);
  }
  pushQuad(positions, indices, eaveAuto[0]!, eaveAuto[1]!, R1t, R0t);
  pushQuad(positions, indices, eaveAuto[3]!, R0t, R1t, eaveAuto[2]!);
  pushTri(positions, indices, eaveAuto[0]![0], eaveAuto[0]![1], eaveAuto[0]![2], eaveAuto[3]![0], eaveAuto[3]![1], eaveAuto[3]![2], R0t[0], R0t[1], R0t[2]);
  pushTri(positions, indices, eaveAuto[1]![0], eaveAuto[1]![1], eaveAuto[1]![2], R1t[0], R1t[1], R1t[2], eaveAuto[2]![0], eaveAuto[2]![1], eaveAuto[2]![2]);

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
