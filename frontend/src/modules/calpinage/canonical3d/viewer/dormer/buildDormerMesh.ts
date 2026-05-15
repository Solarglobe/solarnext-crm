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
  let cz = 0;
  for (const p of baseRing) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= n;
  cy /= n;
  cz /= n;

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

  let minU = Infinity;
  let maxU = -Infinity;
  for (const p of baseRing) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const u = dx * ux + dy * uy;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
  }
  let perimeterM = 0;
  for (let i = 0; i < n; i++) {
    const a = baseRing[i]!;
    const b = baseRing[(i + 1) % n]!;
    perimeterM += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const spanU = Math.max(0.4, maxU - minU);
  const depthGuess = ext.depthM != null && finiteNum(ext.depthM) && ext.depthM > 0
    ? ext.depthM
    : Math.max(0.4, perimeterM / Math.max(4, n * 2));

  const wallH =
    ext.wallHeightM != null && finiteNum(ext.wallHeightM) && ext.wallHeightM > 0
      ? ext.wallHeightM
      : Math.max(0.18, Math.min(ridgeH * 0.42, depthGuess * 0.32));

  const eaveRing: [number, number, number][] = baseRing.map((p) => [p[0], p[1], p[2] + wallH]);
  const ridgeHalfLength = Math.max(0.16, Math.min(0.55, spanU * 0.22));
  const R0t: [number, number, number] = [cx - ux * ridgeHalfLength, cy - uy * ridgeHalfLength, cz + ridgeH];
  const R1t: [number, number, number] = [cx + ux * ridgeHalfLength, cy + uy * ridgeHalfLength, cz + ridgeH];
  const ridgePointFor = (i: number): [number, number, number] => {
    const p = baseRing[i]!;
    const u = (p[0] - cx) * ux + (p[1] - cy) * uy;
    return u < 0 ? R0t : R1t;
  };

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    pushQuad(positions, indices, baseRing[i]!, baseRing[(i + 1) % n]!, eaveRing[(i + 1) % n]!, eaveRing[i]!);
  }
  for (let i = 0; i < n; i++) {
    const a = eaveRing[i]!;
    const b = eaveRing[(i + 1) % n]!;
    const rA = ridgePointFor(i);
    const rB = ridgePointFor((i + 1) % n);
    if (rA === rB) {
      pushTri(positions, indices, a[0], a[1], a[2], b[0], b[1], b[2], rA[0], rA[1], rA[2]);
    } else {
      pushQuad(positions, indices, a, b, rB, rA);
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
