/**
 * Construction pure d'un maillage lucarne / chien assis.
 *
 * Regle metier importante :
 * - le contour Phase 2 definit l'emprise toiture ;
 * - le faitage Phase 2 definit l'orientation quand il est disponible ;
 * - les aretiers Phase 2 restent des guides de dessin/compatibilite, mais ne sont plus interpretes
 *   comme des sommets 3D libres. C'est ce qui produisait les pyramides/tentes instables.
 */

import * as THREE from "three";
import { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "../../builder/worldMapping";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { sampleRoofZAtImagePxFromPatches } from "./sampleRoofZAtImagePxFromPatches";

function dormerAuditLog(msg: string, detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __CALPINAGE_DORMER_AUDIT__?: boolean };
  if (w.__CALPINAGE_DORMER_AUDIT__ !== true) return;
  if (detail && Object.keys(detail).length > 0) console.log("[DORMER_AUDIT]", msg, detail);
  else console.log("[DORMER_AUDIT]", msg);
}

export type DormerRoofModelForMesh = {
  readonly world: CanonicalWorldConfig;
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
};

export type DormerRuntimeExtensionInput = {
  readonly type?: string;
  readonly kind?: string;
  readonly dormerType?: string;
  readonly visualModel?: string;
  readonly depthM?: number;
  readonly wallHeightM?: number;
  readonly roofRiseM?: number;
  readonly ridgeHeightRelM?: number;
  readonly ridge?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
  readonly hips?: unknown;
  readonly contour?: {
    readonly closed?: boolean;
    readonly points?: ReadonlyArray<{ readonly x?: number; readonly y?: number }>;
  };
};

type Point2 = { readonly x: number; readonly y: number };
type Point3 = readonly [number, number, number];

function finiteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function validPoint(p: { readonly x?: number; readonly y?: number } | undefined): p is Point2 {
  return !!p && finiteNum(p.x) && finiteNum(p.y);
}

function pushTri(positions: number[], indices: number[], a: Point3, b: Point3, c: Point3): void {
  const base = positions.length / 3;
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  indices.push(base, base + 1, base + 2);
}

function pushQuad(positions: number[], indices: number[], a: Point3, b: Point3, c: Point3, d: Point3): void {
  pushTri(positions, indices, a, b, c);
  pushTri(positions, indices, a, c, d);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function longestRingEdgeDirection(baseRing: readonly Point3[]): { x: number; y: number } | null {
  let bestLen = 0;
  let best = { x: 1, y: 0 };
  for (let i = 0; i < baseRing.length; i++) {
    const a = baseRing[i]!;
    const b = baseRing[(i + 1) % baseRing.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      best = { x: dx / len, y: dy / len };
    }
  }
  return bestLen > 1e-6 ? best : null;
}

function makeWorldSampler(roofModel: DormerRoofModelForMesh): (x: number, y: number) => Point3 | null {
  const { metersPerPixel, northAngleDeg } = roofModel.world;
  return (x: number, y: number) => {
    const img = worldHorizontalMToImagePx(x, y, metersPerPixel, northAngleDeg);
    const z = sampleRoofZAtImagePxFromPatches(img.xPx, img.yPx, roofModel.roofPlanePatches, roofModel.world);
    if (z != null) return [x, y, z];
    const plane = roofModel.roofPlanePatches.find((p) => {
      const n = p.equation?.normal;
      return n && finiteNum(n.x) && finiteNum(n.y) && finiteNum(n.z) && Math.abs(n.z) > 1e-6 && finiteNum(p.equation?.d);
    })?.equation;
    if (!plane) return null;
    return [x, y, -((plane.normal.x * x + plane.normal.y * y + plane.d) / plane.normal.z)];
  };
}

function buildBaseRing(
  ring: readonly Point2[],
  roofModel: DormerRoofModelForMesh,
): Point3[] | null {
  const { metersPerPixel, northAngleDeg } = roofModel.world;
  const out: Point3[] = [];
  for (const p of ring) {
    const z = sampleRoofZAtImagePxFromPatches(p.x, p.y, roofModel.roofPlanePatches, roofModel.world);
    if (z == null) {
      dormerAuditLog("GUARD: sampleRoofZ null on contour", { x: p.x, y: p.y });
      return null;
    }
    const w = imagePxToWorldHorizontalM(p.x, p.y, metersPerPixel, northAngleDeg);
    out.push([w.x, w.y, z]);
  }
  return out;
}

function pointAt(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
  u: number,
  v: number,
  sampleWorld: (x: number, y: number) => Point3 | null,
): Point3 | null {
  return sampleWorld(cx + ux * u + vx * v, cy + uy * u + vy * v);
}

/**
 * Retourne une geometrie triangulee ou `null` si les donnees sont insuffisantes.
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

  const ptsIn = ext.contour?.points;
  if (!ptsIn || ptsIn.length < 3) {
    dormerAuditLog("GUARD: contour invalid (points length)", { contourPointsLen: ptsIn?.length ?? 0 });
    return null;
  }
  const ring: Point2[] = [];
  for (const p of ptsIn) if (validPoint(p)) ring.push({ x: p.x, y: p.y });
  if (ring.length > 1 && Math.hypot(ring[0]!.x - ring[ring.length - 1]!.x, ring[0]!.y - ring[ring.length - 1]!.y) < 1e-6) {
    ring.pop();
  }
  if (ring.length < 3) {
    dormerAuditLog("GUARD: contour invalid (finite points < 3)", { finitePoints: ring.length });
    return null;
  }

  const { metersPerPixel, northAngleDeg } = roofModel.world;
  if (!finiteNum(metersPerPixel) || metersPerPixel <= 0) {
    dormerAuditLog("GUARD: metersPerPixel invalid", { metersPerPixel });
    return null;
  }

  const baseRing = buildBaseRing(ring, roofModel);
  if (!baseRing) return null;

  let cx = 0;
  let cy = 0;
  for (const p of baseRing) {
    cx += p[0];
    cy += p[1];
  }
  cx /= baseRing.length;
  cy /= baseRing.length;

  const ra = ext.ridge?.a;
  const rb = ext.ridge?.b;
  let ux = 0;
  let uy = 0;
  if (validPoint(ra) && validPoint(rb)) {
    const a = imagePxToWorldHorizontalM(ra.x, ra.y, metersPerPixel, northAngleDeg);
    const b = imagePxToWorldHorizontalM(rb.x, rb.y, metersPerPixel, northAngleDeg);
    ux = b.x - a.x;
    uy = b.y - a.y;
  }
  let uLen = Math.hypot(ux, uy);
  if (uLen < 1e-6) {
    const best = longestRingEdgeDirection(baseRing);
    if (!best) {
      dormerAuditLog("GUARD: dormer orientation invalid");
      return null;
    }
    ux = best.x;
    uy = best.y;
    uLen = 1;
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

  const spanU = maxU - minU;
  const spanV = maxV - minV;
  if (spanU < 0.12 || spanV < 0.12) {
    dormerAuditLog("GUARD: contour too small", { spanU, spanV });
    return null;
  }

  const shrink = 0.92;
  let halfU = Math.max(0.06, (spanU * shrink) / 2);
  let halfV = Math.max(0.06, (spanV * shrink) / 2);
  const minX = Math.min(...baseRing.map((p) => p[0]));
  const maxX = Math.max(...baseRing.map((p) => p[0]));
  const minY = Math.min(...baseRing.map((p) => p[1]));
  const maxY = Math.max(...baseRing.map((p) => p[1]));
  const insideWorldBounds = (u: number, v: number): boolean => {
    const x = cx + ux * u + vx * v;
    const y = cy + uy * u + vy * v;
    return x >= minX - 1e-6 && x <= maxX + 1e-6 && y >= minY - 1e-6 && y <= maxY + 1e-6;
  };
  for (let guard = 0; guard < 10; guard++) {
    if (
      insideWorldBounds(-halfU, -halfV) &&
      insideWorldBounds(halfU, -halfV) &&
      insideWorldBounds(halfU, halfV) &&
      insideWorldBounds(-halfU, halfV)
    ) {
      break;
    }
    halfU *= 0.9;
    halfV *= 0.9;
  }
  const totalH = clamp(finiteNum(ext.ridgeHeightRelM) ? ext.ridgeHeightRelM : 0.9, 0.55, 1.05);
  const wallH = clamp(finiteNum(ext.wallHeightM) ? ext.wallHeightM : totalH * 0.38, 0.22, Math.min(0.48, totalH - 0.2));
  const roofRise = clamp(finiteNum(ext.roofRiseM) ? ext.roofRiseM : totalH - wallH, 0.25, Math.max(0.25, totalH - wallH));
  const finalTotalH = clamp(wallH + roofRise, 0.55, 1.05);
  const ridgeHalfU = Math.max(0.05, halfU * 0.7);

  const sampleWorld = makeWorldSampler(roofModel);
  const b0 = pointAt(cx, cy, ux, uy, vx, vy, -halfU, -halfV, sampleWorld);
  const b1 = pointAt(cx, cy, ux, uy, vx, vy, halfU, -halfV, sampleWorld);
  const b2 = pointAt(cx, cy, ux, uy, vx, vy, halfU, halfV, sampleWorld);
  const b3 = pointAt(cx, cy, ux, uy, vx, vy, -halfU, halfV, sampleWorld);
  const r0Base = pointAt(cx, cy, ux, uy, vx, vy, -ridgeHalfU, 0, sampleWorld);
  const r1Base = pointAt(cx, cy, ux, uy, vx, vy, ridgeHalfU, 0, sampleWorld);
  if (!b0 || !b1 || !b2 || !b3 || !r0Base || !r1Base) {
    dormerAuditLog("GUARD: generated point outside roof patches");
    return null;
  }

  const e0: Point3 = [b0[0], b0[1], b0[2] + wallH];
  const e1: Point3 = [b1[0], b1[1], b1[2] + wallH];
  const e2: Point3 = [b2[0], b2[1], b2[2] + wallH];
  const e3: Point3 = [b3[0], b3[1], b3[2] + wallH];
  const r0: Point3 = [r0Base[0], r0Base[1], r0Base[2] + finalTotalH];
  const r1: Point3 = [r1Base[0], r1Base[1], r1Base[2] + finalTotalH];

  const positions: number[] = [];
  const indices: number[] = [];

  pushQuad(positions, indices, b0, b1, e1, e0);
  pushQuad(positions, indices, b1, b2, e2, e1);
  pushQuad(positions, indices, b2, b3, e3, e2);
  pushQuad(positions, indices, b3, b0, e0, e3);
  pushQuad(positions, indices, e0, e1, r1, r0);
  pushQuad(positions, indices, e3, r0, r1, e2);
  pushTri(positions, indices, e0, r0, e3);
  pushTri(positions, indices, e1, e2, r1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  dormerAuditLog("RESULT: parametric_gable geometry", {
    positionCount: posAttr?.count ?? 0,
    spanU,
    spanV,
    wallH,
    finalTotalH,
  });
  return geo;
}

export function buildDormerEdgesGeometry(meshGeo: THREE.BufferGeometry): THREE.BufferGeometry | null {
  try {
    return new THREE.EdgesGeometry(meshGeo, 38);
  } catch {
    return null;
  }
}
