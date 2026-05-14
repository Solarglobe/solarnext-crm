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

  const zR0b = sampleZ(ra.x, ra.y);
  const zR1b = sampleZ(rb.x, rb.y);
  if (zR0b == null || zR1b == null) {
    dormerAuditLog("GUARD: sampleRoofZ null", {
      zR0b: zR0b === null ? "null" : zR0b,
      zR1b: zR1b === null ? "null" : zR1b,
    });
    return null;
  }

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
  let perimeterM = 0;
  for (let i = 0; i < n; i++) {
    const a = baseRing[i]!;
    const b = baseRing[(i + 1) % n]!;
    perimeterM += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const depthGuess =
    ext.depthM != null && finiteNum(ext.depthM) && ext.depthM > 0
      ? ext.depthM
      : Math.max(0.4, perimeterM / Math.max(4, n * 2));

  const wallH =
    ext.wallHeightM != null && finiteNum(ext.wallHeightM) && ext.wallHeightM > 0
      ? ext.wallHeightM
      : Math.max(0.18, Math.min(ridgeH * 0.42, depthGuess * 0.32));

  const eaveRing: [number, number, number][] = baseRing.map((p) => [p[0], p[1], p[2] + wallH]);
  const R0t: [number, number, number] = [wR0.x, wR0.y, zR0b + ridgeH];
  const R1t: [number, number, number] = [wR1.x, wR1.y, zR1b + ridgeH];

  const ridgeDx = R1t[0] - R0t[0];
  const ridgeDy = R1t[1] - R0t[1];
  const ridgeLenSq = ridgeDx * ridgeDx + ridgeDy * ridgeDy;
  if (ridgeLenSq < 1e-9) {
    dormerAuditLog("GUARD: ridge world length invalid", { ridgeLenSq });
    return null;
  }
  const ridgeAt = (p: readonly [number, number, number]): [number, number, number] => {
    const tRaw = ((p[0] - R0t[0]) * ridgeDx + (p[1] - R0t[1]) * ridgeDy) / ridgeLenSq;
    const t = Math.max(0, Math.min(1, tRaw));
    return [
      R0t[0] + (R1t[0] - R0t[0]) * t,
      R0t[1] + (R1t[1] - R0t[1]) * t,
      R0t[2] + (R1t[2] - R0t[2]) * t,
    ];
  };

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    pushQuad(positions, indices, baseRing[i]!, baseRing[(i + 1) % n]!, eaveRing[(i + 1) % n]!, eaveRing[i]!);
  }

  const leftHipA = ext.hips?.left?.a;
  const rightHipA = ext.hips?.right?.a;
  const hipPeak = ext.hips?.left?.b ?? ext.hips?.right?.b ?? ra;
  const drawnAreaPx = polygonArea2d(ring);
  if (
    leftHipA &&
    rightHipA &&
    hipPeak &&
    finiteNum(leftHipA.x) &&
    finiteNum(leftHipA.y) &&
    finiteNum(rightHipA.x) &&
    finiteNum(rightHipA.y) &&
    finiteNum(hipPeak.x) &&
    finiteNum(hipPeak.y) &&
    drawnAreaPx > 1e-6
  ) {
    const zPeakBase = sampleZ(hipPeak.x, hipPeak.y);
    if (zPeakBase == null) {
      dormerAuditLog("GUARD: sampleRoofZ null on hip peak", { x: hipPeak.x, y: hipPeak.y });
      return null;
    }
    const leftHipPoint = { x: leftHipA.x, y: leftHipA.y };
    const rightHipPoint = { x: rightHipA.x, y: rightHipA.y };
    const wPeak = imagePxToWorldHorizontalM(hipPeak.x, hipPeak.y, mpp, north);
    const peakTop: [number, number, number] = [wPeak.x, wPeak.y, zPeakBase + ridgeH];
    const li = nearestRingIndex(ring, leftHipPoint);
    const ri = nearestRingIndex(ring, rightHipPoint);
    const cw = ringPathIndices(li, ri, n, true);
    const ccw = ringPathIndices(li, ri, n, false);
    const polyArea = (path: readonly number[]) => polygonArea2d(path.map((idx) => ring[idx]!));
    const front = polyArea(cw) <= polyArea(ccw) ? cw : ccw;
    const back = front === cw ? ccw : cw;
    for (let i = 0; i < front.length - 1; i++) {
      pushTri(
        positions,
        indices,
        eaveRing[front[i]!]![0],
        eaveRing[front[i]!]![1],
        eaveRing[front[i]!]![2],
        eaveRing[front[i + 1]!]![0],
        eaveRing[front[i + 1]!]![1],
        eaveRing[front[i + 1]!]![2],
        peakTop[0],
        peakTop[1],
        peakTop[2],
      );
    }
    for (let i = 0; i < back.length - 1; i++) {
      pushTri(
        positions,
        indices,
        eaveRing[back[i]!]![0],
        eaveRing[back[i]!]![1],
        eaveRing[back[i]!]![2],
        eaveRing[back[i + 1]!]![0],
        eaveRing[back[i + 1]!]![1],
        eaveRing[back[i + 1]!]![2],
        peakTop[0],
        peakTop[1],
        peakTop[2],
      );
    }
  } else {
    for (let i = 0; i < n; i++) {
      const a = eaveRing[i]!;
      const b = eaveRing[(i + 1) % n]!;
      const raTop = ridgeAt(a);
      const rbTop = ridgeAt(b);
      pushQuad(positions, indices, a, b, rbTop, raTop);
    }
  }

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
