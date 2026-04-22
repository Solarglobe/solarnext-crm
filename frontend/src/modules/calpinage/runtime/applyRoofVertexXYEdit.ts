/**
 * Mutation officielle XY (plan image px) sur un sommet de `CALPINAGE_STATE.pans[]`.
 * Garde-fous : déplacement clampé en px, polygone simple (≥ 3 sommets, aire > 0, pas d’auto-croisement).
 * Ne fusionne pas les pans ni ne modifie les autres polygones.
 *
 * Après succès : `emitOfficialRuntimeStructuralChange({ changedDomains: ["pans"] })`.
 */

import { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "../canonical3d/builder/worldMapping";
import { signedArea2d, triangulateSimplePolygon2dCcW } from "../canonical3d/utils/triangulateSimplePolygon2d";
import { resolvePanPolygonFor3D } from "../integration/resolvePanPolygonFor3D";
import { peekCalpinageRuntimeWorldFrame } from "../canonical3d/world/normalizeWorldConfig";
import { syncPointsFromPolygonPx } from "./syncPointsFromPolygonPx";
import { syncPolygonPxFromPoints } from "./syncPolygonPxFromPoints";

export const ROOF_VERTEX_XY_EDIT_DEFAULT_MAX_DISPLACEMENT_PX = 64;

export type RoofVertexXYEdit =
  | {
      readonly panId: string;
      readonly vertexIndex: number;
      readonly mode: "imagePx";
      readonly xPx: number;
      readonly yPx: number;
    }
  | {
      readonly panId: string;
      readonly vertexIndex: number;
      readonly mode: "deltaWorldM";
      readonly dxM: number;
      readonly dyM: number;
    };

export type ApplyRoofVertexXYEditOptions = {
  /** Rayon max (px image) par rapport à la position actuelle du sommet ; défaut {@link ROOF_VERTEX_XY_EDIT_DEFAULT_MAX_DISPLACEMENT_PX}. */
  readonly maxDisplacementPx?: number;
};

export type ApplyRoofVertexXYEditResult =
  | { readonly ok: true; readonly clamped: boolean }
  | { readonly ok: false; readonly code: string; readonly message: string };

type MutablePoly = { readonly points: Record<string, unknown>[] };

const MIN_ABS_AREA_PX2 = 1e-3;
const CROSS_EPS = 1e-9;

function getMutablePanPolygon(pan: Record<string, unknown>): MutablePoly | null {
  const { raw } = resolvePanPolygonFor3D(pan);
  if (!raw) return null;
  return { points: raw as Record<string, unknown>[] };
}

function readMppAndNorth(runtime: Record<string, unknown>): { mpp: number; northAngleDeg: number } | null {
  const peek = peekCalpinageRuntimeWorldFrame(runtime);
  if (peek && typeof peek.metersPerPixel === "number" && peek.metersPerPixel > 0) {
    return {
      mpp: peek.metersPerPixel,
      northAngleDeg:
        typeof peek.northAngleDeg === "number" && Number.isFinite(peek.northAngleDeg) ? peek.northAngleDeg : 0,
    };
  }
  const roof = runtime.roof;
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const scale = r.scale as { metersPerPixel?: number } | undefined;
  const mpp = scale?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;
  const roofBlock = r.roof as { north?: { angleDeg?: number } } | undefined;
  const northAngleDeg =
    typeof roofBlock?.north?.angleDeg === "number" && Number.isFinite(roofBlock.north.angleDeg)
      ? roofBlock.north.angleDeg
      : 0;
  return { mpp, northAngleDeg };
}

function ringXYFromPoints(points: readonly Record<string, unknown>[]): { x: number; y: number }[] {
  return points.map((p) => ({
    x: Number((p as { x?: unknown }).x),
    y: Number((p as { y?: unknown }).y),
  }));
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(v) < CROSS_EPS) return 0;
  return v > 0 ? 1 : 2;
}

function onSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (
    bx >= Math.min(ax, cx) - CROSS_EPS &&
    bx <= Math.max(ax, cx) + CROSS_EPS &&
    by >= Math.min(ay, cy) - CROSS_EPS &&
    by <= Math.max(ay, cy) + CROSS_EPS
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(ax, ay, cx, cy, bx, by)) return true;
  if (o2 === 0 && onSeg(ax, ay, dx, dy, bx, by)) return true;
  if (o3 === 0 && onSeg(cx, cy, ax, ay, dx, dy)) return true;
  if (o4 === 0 && onSeg(cx, cy, bx, by, dx, dy)) return true;
  return false;
}

/** `true` si deux arêtes non consécutives du contour se croisent (polygone non simple). */
export function polygonPxRingSelfIntersects(ring: readonly { readonly x: number; readonly y: number }[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const ax = ring[i]!.x;
    const ay = ring[i]!.y;
    const bx = ring[i2]!.x;
    const by = ring[i2]!.y;
    for (let j = i + 1; j < n; j++) {
      const j2 = (j + 1) % n;
      if (i2 === j || j2 === i) continue;
      const cx = ring[j]!.x;
      const cy = ring[j]!.y;
      const dx = ring[j2]!.x;
      const dy = ring[j2]!.y;
      if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return true;
    }
  }
  return false;
}

export type SimplePolygonPxValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function validatePanPolygonPxSimple(
  xy: readonly { readonly x: number; readonly y: number }[],
): SimplePolygonPxValidationResult {
  if (xy.length < 3) {
    return { ok: false, code: "POLY_TOO_FEW_POINTS", message: "Au moins 3 sommets requis." };
  }
  for (const p of xy) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return { ok: false, code: "POLY_NON_FINITE", message: "Coordonnées sommet non finies." };
    }
  }
  const areaAbs = Math.abs(signedArea2d(xy));
  if (areaAbs <= MIN_ABS_AREA_PX2) {
    return { ok: false, code: "POLY_ZERO_OR_NEGATIVE_AREA", message: "Aire du polygone nulle ou dégénérée." };
  }
  if (polygonPxRingSelfIntersects(xy)) {
    return { ok: false, code: "POLY_SELF_INTERSECT", message: "Le contour s’auto-croise (polygone non simple)." };
  }
  const ccw = signedArea2d(xy) >= 0 ? xy.slice() : xy.slice().reverse();
  if (triangulateSimplePolygon2dCcW(ccw) == null) {
    return { ok: false, code: "POLY_NOT_SIMPLE_OR_EARS_FAIL", message: "Polygone non simple ou triangulation impossible." };
  }
  return { ok: true };
}

function clampDisplacement2D(
  x0: number,
  y0: number,
  tx: number,
  ty: number,
  maxD: number,
): { readonly x: number; readonly y: number; readonly clamped: boolean } {
  if (!Number.isFinite(maxD) || maxD <= 0 || maxD === Number.POSITIVE_INFINITY) {
    return { x: tx, y: ty, clamped: false };
  }
  const dx = tx - x0;
  const dy = ty - y0;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= maxD) return { x: tx, y: ty, clamped: false };
  const s = maxD / len;
  return { x: x0 + dx * s, y: y0 + dy * s, clamped: true };
}

/**
 * Applique un déplacement XY sur un sommet ; en cas d’échec de validation, l’état n’est pas modifié.
 */
export function applyRoofVertexXYEdit(
  runtime: unknown,
  edit: RoofVertexXYEdit,
  options?: ApplyRoofVertexXYEditOptions,
): ApplyRoofVertexXYEditResult {
  if (!Number.isInteger(edit.vertexIndex) || edit.vertexIndex < 0) {
    return { ok: false, code: "INVALID_VERTEX_INDEX", message: "vertexIndex entier ≥ 0 requis." };
  }
  if (!runtime || typeof runtime !== "object") {
    return { ok: false, code: "RUNTIME_MISSING", message: "Runtime absent ou invalide." };
  }
  const root = runtime as Record<string, unknown>;
  const scaleNorth = readMppAndNorth(root);
  if (!scaleNorth) {
    return { ok: false, code: "SCALE_OR_MPP_MISSING", message: "Échelle (metersPerPixel) introuvable sur le runtime." };
  }
  const { mpp, northAngleDeg } = scaleNorth;
  const pans = root.pans;
  if (!Array.isArray(pans)) {
    return { ok: false, code: "PANS_MISSING", message: "state.pans absent ou non tableau." };
  }
  const panId = String(edit.panId);
  const panRec = pans.find((p) => p && typeof p === "object" && String((p as Record<string, unknown>).id) === panId);
  if (!panRec || typeof panRec !== "object") {
    return { ok: false, code: "PAN_NOT_FOUND", message: `Aucun pan id « ${panId} » dans state.pans.` };
  }
  const poly = getMutablePanPolygon(panRec as Record<string, unknown>);
  if (!poly) {
    return {
      ok: false,
      code: "PAN_POLYGON_MISSING",
      message: "Polygone pan introuvable (polygonPx / points / polygon / contour.points).",
    };
  }
  if (edit.vertexIndex >= poly.points.length) {
    return {
      ok: false,
      code: "VERTEX_OUT_OF_RANGE",
      message: `vertexIndex ${edit.vertexIndex} ≥ ${poly.points.length} sommets.`,
    };
  }
  const pt = poly.points[edit.vertexIndex]!;
  if (!pt || typeof pt !== "object") {
    return { ok: false, code: "VERTEX_INVALID", message: "Sommet polygone absent ou invalide." };
  }

  const x0 = Number((pt as { x?: unknown }).x);
  const y0 = Number((pt as { y?: unknown }).y);
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
    return { ok: false, code: "VERTEX_XY_INVALID", message: "Position actuelle du sommet non finie." };
  }

  let rawTx: number;
  let rawTy: number;
  if (edit.mode === "imagePx") {
    if (!Number.isFinite(edit.xPx) || !Number.isFinite(edit.yPx)) {
      return { ok: false, code: "TARGET_XY_INVALID", message: "xPx / yPx doivent être des nombres finis." };
    }
    rawTx = edit.xPx;
    rawTy = edit.yPx;
  } else {
    if (!Number.isFinite(edit.dxM) || !Number.isFinite(edit.dyM)) {
      return { ok: false, code: "DELTA_WORLD_INVALID", message: "dxM / dyM doivent être des nombres finis." };
    }
    const w0 = imagePxToWorldHorizontalM(x0, y0, mpp, northAngleDeg);
    const { xPx, yPx } = worldHorizontalMToImagePx(w0.x + edit.dxM, w0.y + edit.dyM, mpp, northAngleDeg);
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) {
      return { ok: false, code: "WORLD_TO_PX_FAILED", message: "Conversion monde → px impossible." };
    }
    rawTx = xPx;
    rawTy = yPx;
  }

  const maxD = options?.maxDisplacementPx ?? ROOF_VERTEX_XY_EDIT_DEFAULT_MAX_DISPLACEMENT_PX;
  const { x: cx, y: cy, clamped } = clampDisplacement2D(x0, y0, rawTx, rawTy, maxD);

  const trial = ringXYFromPoints(poly.points);
  trial[edit.vertexIndex] = { x: cx, y: cy };
  const v = validatePanPolygonPxSimple(trial);
  if (!v.ok) {
    return v;
  }

  (pt as { x: number; y: number }).x = cx;
  (pt as { x: number; y: number }).y = cy;
  const panObj = panRec as Record<string, unknown>;
  if (poly.points === panObj.points) {
    syncPolygonPxFromPoints(panObj);
  } else if (poly.points === panObj.polygonPx) {
    syncPointsFromPolygonPx(panObj);
  }
  return { ok: true, clamped };
}
