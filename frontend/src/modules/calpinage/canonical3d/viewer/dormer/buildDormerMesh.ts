/**
 * Construction pure d'un maillage lucarne / chien assis.
 *
 * Regle metier importante :
 * - le contour Phase 2 definit l'emprise toiture ;
 * - le faitage Phase 2 definit l'orientation quand il est disponible ;
 * - les aretiers Phase 2 restent des guides de dessin/compatibilite, mais ne sont plus interpretes
 *   comme des sommets 3D libres. C'est ce qui produisait les pyramides/tentes instables.
 *
 * Topologie mesh : pignon (gable dormer) avec faitage lateral, identique au chemin fallback.
 *   - 4 murs verticaux (base ring -> hauteur mur)
 *   - versant avant et versant arriere (2 quads)
 *   - 2 pignons lateraux (triangles)
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
  readonly canonicalDormerGeometry?: {
    readonly vertices?: ReadonlyArray<{
      readonly id?: string;
      readonly role?: string;
      readonly x?: number;
      readonly y?: number;
      readonly h?: number;
    }>;
    readonly edges?: ReadonlyArray<{
      readonly id?: string;
      readonly a?: string;
      readonly b?: string;
      readonly role?: string;
    }>;
    readonly faces?: ReadonlyArray<{
      readonly id?: string;
      readonly role?: string;
      readonly vertexIds?: ReadonlyArray<string>;
    }>;
  };
  readonly depthM?: number;
  readonly wallHeightM?: number;
  readonly roofRiseM?: number;
  readonly ridgeHeightRelM?: number;
  readonly ridge?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
  readonly dormerModel?: {
    readonly version?: number;
    readonly front?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
    readonly ridge?: { readonly a?: { readonly x?: number; readonly y?: number }; readonly b?: { readonly x?: number; readonly y?: number } };
    readonly axes?: { readonly ux?: number; readonly uy?: number; readonly vx?: number; readonly vy?: number };
    readonly bounds?: { readonly minU?: number; readonly maxU?: number; readonly minV?: number; readonly maxV?: number };
  };
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

/** Extrait le premier plan de toit avec equation valide (fallback Z). */
function findFallbackPlane(
  roofPlanePatches: readonly RoofPlanePatch3D[],
): { normal: { x: number; y: number; z: number }; d: number } | null {
  for (const patch of roofPlanePatches) {
    const n = patch.equation?.normal;
    const d = patch.equation?.d;
    if (n && finiteNum(n.x) && finiteNum(n.y) && finiteNum(n.z) && Math.abs(n.z) > 1e-6 && finiteNum(d)) {
      return { normal: { x: n.x, y: n.y, z: n.z }, d };
    }
  }
  return null;
}

/**
 * Convertit un point image en point 3D monde.
 * Fallback automatique sur l'equation de plan si le sampler ne couvre pas ce pixel
 * (evite le retour null qui bloquait tout le mesh).
 */
function imagePointToWorld3(
  p: Point2,
  roofModel: DormerRoofModelForMesh,
): Point3 | null {
  const { metersPerPixel, northAngleDeg } = roofModel.world;
  const w = imagePxToWorldHorizontalM(p.x, p.y, metersPerPixel, northAngleDeg);
  let z = sampleRoofZAtImagePxFromPatches(p.x, p.y, roofModel.roofPlanePatches, roofModel.world);
  if (z == null) {
    const plane = findFallbackPlane(roofModel.roofPlanePatches);
    if (plane) z = -((plane.normal.x * w.x + plane.normal.y * w.y + plane.d) / plane.normal.z);
  }
  if (z == null) return null;
  return [w.x, w.y, z];
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

function buildDormerMeshFromCanonicalGeometry(
  ext: DormerRuntimeExtensionInput,
  roofModel: DormerRoofModelForMesh,
): THREE.BufferGeometry | null {
  const model = ext.canonicalDormerGeometry;
  const vertices = model?.vertices;
  const faces = model?.faces;
  if (!vertices || !faces || vertices.length < 3 || faces.length < 1) return null;

  const byId = new Map<string, Point3>();
  for (const v of vertices) {
    if (!v.id || !finiteNum(v.x) || !finiteNum(v.y)) continue;
    const base = imagePointToWorld3({ x: v.x, y: v.y }, roofModel);
    if (!base) continue;
    const h = finiteNum(v.h) ? v.h : 0;
    byId.set(v.id, [base[0], base[1], base[2] + h]);
  }

  const positions: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    const ids = face.vertexIds ?? [];
    if (ids.length < 3) continue;
    const p0 = byId.get(ids[0]!);
    if (!p0) continue;
    for (let i = 1; i < ids.length - 1; i++) {
      const p1 = byId.get(ids[i]!);
      const p2 = byId.get(ids[i + 1]!);
      if (!p1 || !p2) continue;
      pushTri(positions, indices, p0, p1, p2);
    }
  }

  if (positions.length < 9 || indices.length < 3) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  dormerAuditLog("RESULT: canonicalDormerGeometry", {
    vertexCount: vertices.length,
    faceCount: faces.length,
    positionCount: (geo.getAttribute("position") as THREE.BufferAttribute | undefined)?.count ?? 0,
  });
  return geo;
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

/**
 * Construit le ring de base en coordonnees monde a partir des points contour (pixels image).
 * Fallback sur l'equation de plan si sampleRoofZAtImagePxFromPatches ne couvre pas le point.
 */
function buildBaseRing(
  ring: readonly Point2[],
  roofModel: DormerRoofModelForMesh,
): Point3[] | null {
  const { metersPerPixel, northAngleDeg } = roofModel.world;
  const fallbackPlane = findFallbackPlane(roofModel.roofPlanePatches);
  const out: Point3[] = [];
  for (const p of ring) {
    const w = imagePxToWorldHorizontalM(p.x, p.y, metersPerPixel, northAngleDeg);
    let z = sampleRoofZAtImagePxFromPatches(p.x, p.y, roofModel.roofPlanePatches, roofModel.world);
    if (z == null && fallbackPlane) {
      z = -((fallbackPlane.normal.x * w.x + fallbackPlane.normal.y * w.y + fallbackPlane.d) / fallbackPlane.normal.z);
    }
    if (z == null) {
      dormerAuditLog("GUARD: sampleRoofZ null on contour (no fallback plane)", { x: p.x, y: p.y });
      return null;
    }
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
 * Topologie : pignon (gable dormer) avec faitage lateral.
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

  const canonicalGeo = buildDormerMeshFromCanonicalGeometry(ext, roofModel);
  if (canonicalGeo) return canonicalGeo;
  if (ext.visualModel === "manual_outline_gable") {
    dormerAuditLog("GUARD: manual dormer without canonical geometry");
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

  const modelRidgeA = ext.dormerModel?.ridge?.a;
  const modelRidgeB = ext.dormerModel?.ridge?.b;
  const modelFrontA = ext.dormerModel?.front?.a;
  const modelFrontB = ext.dormerModel?.front?.b;
  const modelAxes = ext.dormerModel?.axes;
  const modelBounds = ext.dormerModel?.bounds;
  if (
    validPoint(modelRidgeA) &&
    validPoint(modelRidgeB) &&
    validPoint(modelFrontA) &&
    validPoint(modelFrontB) &&
    finiteNum(modelAxes?.ux) &&
    finiteNum(modelAxes?.uy) &&
    finiteNum(modelAxes?.vx) &&
    finiteNum(modelAxes?.vy) &&
    finiteNum(modelBounds?.minU) &&
    finiteNum(modelBounds?.maxU) &&
    finiteNum(modelBounds?.minV) &&
    finiteNum(modelBounds?.maxV)
  ) {
    const ridgeBase0 = imagePointToWorld3(modelRidgeA, roofModel);
    const ridgeBase1 = imagePointToWorld3(modelRidgeB, roofModel);
    const frontBase0 = imagePointToWorld3(modelFrontA, roofModel);
    const frontBase1 = imagePointToWorld3(modelFrontB, roofModel);
    if (ridgeBase0 && ridgeBase1 && frontBase0 && frontBase1) {
      const uxi = modelAxes.ux;
      const uyi = modelAxes.uy;
      const vxi = modelAxes.vx;
      const vyi = modelAxes.vy;
      const minUImg = modelBounds.minU;
      const maxUImg = modelBounds.maxU;
      const minVImg = modelBounds.minV;
      const maxVImg = modelBounds.maxV;
      const originImg = {
        x: modelFrontA.x - uxi * minUImg - vxi * minVImg,
        y: modelFrontA.y - uyi * minUImg - vyi * minVImg,
      };
      const imageAt = (u: number, v: number): Point2 => ({
        x: originImg.x + uxi * u + vxi * v,
        y: originImg.y + uyi * u + vyi * v,
      });
      const frontLeftBase = imagePointToWorld3(imageAt(minUImg, minVImg), roofModel);
      const frontRightBase = imagePointToWorld3(imageAt(maxUImg, minVImg), roofModel);
      const backRightBase = imagePointToWorld3(imageAt(maxUImg, maxVImg), roofModel);
      const backLeftBase = imagePointToWorld3(imageAt(minUImg, maxVImg), roofModel);
      if (!frontLeftBase || !frontRightBase || !backRightBase || !backLeftBase) return null;
      const eFrontLeft: Point3 = [frontLeftBase[0], frontLeftBase[1], frontLeftBase[2] + wallH];
      const eFrontRight: Point3 = [frontRightBase[0], frontRightBase[1], frontRightBase[2] + wallH];
      const eBackRight: Point3 = [backRightBase[0], backRightBase[1], backRightBase[2] + wallH];
      const eBackLeft: Point3 = [backLeftBase[0], backLeftBase[1], backLeftBase[2] + wallH];
      // r0 = extremite GAUCHE du faitage lateral, r1 = extremite DROITE
      const r0: Point3 = [ridgeBase0[0], ridgeBase0[1], ridgeBase0[2] + finalTotalH];
      const r1: Point3 = [ridgeBase1[0], ridgeBase1[1], ridgeBase1[2] + finalTotalH];
      const positions: number[] = [];
      const indices: number[] = [];
      // Murs verticaux (base ring -> hauteur mur)
      pushQuad(positions, indices, frontLeftBase, frontRightBase, eFrontRight, eFrontLeft);
      pushQuad(positions, indices, frontRightBase, backRightBase, eBackRight, eFrontRight);
      pushQuad(positions, indices, backRightBase, backLeftBase, eBackLeft, eBackRight);
      pushQuad(positions, indices, backLeftBase, frontLeftBase, eFrontLeft, eBackLeft);
      // Toiture : versant avant (facade -> faitage) et versant arriere (faitage -> arriere)
      pushQuad(positions, indices, eFrontLeft, eFrontRight, r1, r0);
      pushQuad(positions, indices, r0, r1, eBackRight, eBackLeft);
      // Pignons : triangles verticaux gauche et droit
      pushTri(positions, indices, eFrontLeft, r0, eBackLeft);
      pushTri(positions, indices, eFrontRight, eBackRight, r1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      dormerAuditLog("RESULT: phase2_model geometry", {
        positionCount: (geo.getAttribute("position") as THREE.BufferAttribute | undefined)?.count ?? 0,
        contourVertices: baseRing.length,
        wallH,
        finalTotalH,
      });
      return geo;
    }
  }

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

export function buildDormerFrontWindowGeometry(
  ext: DormerRuntimeExtensionInput,
  roofModel: DormerRoofModelForMesh,
): THREE.BufferGeometry | null {
  const modelFrontA = ext.dormerModel?.front?.a;
  const modelFrontB = ext.dormerModel?.front?.b;
  const modelRidgeA = ext.dormerModel?.ridge?.a;
  if (!validPoint(modelFrontA) || !validPoint(modelFrontB) || !validPoint(modelRidgeA)) return null;
  const a = imagePointToWorld3(modelFrontA, roofModel);
  const b = imagePointToWorld3(modelFrontB, roofModel);
  const r = imagePointToWorld3(modelRidgeA, roofModel);
  if (!a || !b || !r) return null;
  const totalH = clamp(finiteNum(ext.ridgeHeightRelM) ? ext.ridgeHeightRelM : 0.9, 0.55, 1.05);
  const wallH = clamp(finiteNum(ext.wallHeightM) ? ext.wallHeightM : totalH * 0.38, 0.22, Math.min(0.48, totalH - 0.2));
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uLen = Math.hypot(ux, uy);
  if (uLen < 0.15) return null;
  const uxn = ux / uLen;
  const uyn = uy / uLen;
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  let nx = midX - r[0];
  let ny = midY - r[1];
  const nLen = Math.hypot(nx, ny) || 1;
  nx /= nLen;
  ny /= nLen;
  const zBase = (a[2] + b[2]) / 2;
  const winHalf = Math.min(0.42, uLen * 0.24);
  const z0 = zBase + Math.max(0.1, wallH * 0.2);
  const z1 = zBase + Math.max(z0 + 0.08, wallH * 0.84);
  const offset = 0.018;
  const p0: Point3 = [midX - uxn * winHalf + nx * offset, midY - uyn * winHalf + ny * offset, z0];
  const p1: Point3 = [midX + uxn * winHalf + nx * offset, midY + uyn * winHalf + ny * offset, z0];
  const p2: Point3 = [midX + uxn * winHalf + nx * offset, midY + uyn * winHalf + ny * offset, z1];
  const p3: Point3 = [midX - uxn * winHalf + nx * offset, midY - uyn * winHalf + ny * offset, z1];
  const positions: number[] = [];
  const indices: number[] = [];
  pushQuad(positions, indices, p0, p1, p2, p3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
