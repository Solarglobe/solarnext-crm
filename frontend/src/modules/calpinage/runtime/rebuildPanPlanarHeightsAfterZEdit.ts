/**
 * Après `applyRoofVertexHeightEdit`, recale les `h` de tous les sommets du pan sur un plan monde
 * (Z = a·x + b·y + c) avec le sommet édité exact, moindres carrés sur les autres — pan coplanaire pour la validation 3D.
 */

import { imagePxToWorldHorizontalM } from "../canonical3d/builder/worldMapping";
import { peekCalpinageRuntimeWorldFrame } from "../canonical3d/world/normalizeWorldConfig";
import { isValidBuildingHeightM } from "../core/heightResolver";
import {
  resolveCalpinagePanPolygonPointsForHeightEdit,
  type RoofVertexHeightEdit,
} from "./applyRoofVertexHeightEdit";
import { syncPointsFromPolygonPx } from "./syncPointsFromPolygonPx";
import { syncPolygonPxFromPoints } from "./syncPolygonPxFromPoints";

export type RebuildPanPlanarHeightsAfterZEditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

const DET_EPS = 1e-18;
/** Sommets adjacents au sommet édités : poids LS plus fort pour limiter la dérive des arêtes (round-trip Z). */
const WEIGHT_ADJACENT_TO_EDIT = 12;
const WEIGHT_OTHER_VERTEX = 1;
/** Si le pan est déjà quasi coplanaire après `applyRoofVertexHeightEdit`, on ne réécrit pas les h (évite bruit flottant). */
const COPLANAR_SKIP_MAX_DEVIATION_M = 2e-3;

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

function readPointPx(pt: Record<string, unknown>): { x: number; y: number } | null {
  const x = Number(pt.x);
  const y = Number(pt.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function readVertexHeightM(pt: Record<string, unknown>): number | null {
  if (typeof pt.h === "number" && Number.isFinite(pt.h)) return pt.h;
  if (typeof pt.heightM === "number" && Number.isFinite(pt.heightM)) return pt.heightM;
  return null;
}

function neighborWeight(n: number, e: number, i: number): number {
  const prev = (e - 1 + n) % n;
  const next = (e + 1) % n;
  return i === prev || i === next ? WEIGHT_ADJACENT_TO_EDIT : WEIGHT_OTHER_VERTEX;
}

/** Écart max |z_i − plan LS(x_i,y_i)| sur tous les sommets (m). */
function maxCoplanarDeviationM(
  xw: readonly number[],
  yw: readonly number[],
  z: readonly number[],
): number {
  const n = z.length;
  if (n < 3) return Infinity;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    sx += xw[i]!;
    sy += yw[i]!;
    sz += z[i]!;
  }
  const inv = 1 / n;
  const mx = sx * inv;
  const my = sy * inv;
  const mz = sz * inv;
  let sxx = 0;
  let sxy = 0;
  let sxz = 0;
  let syy = 0;
  let syz = 0;
  for (let i = 0; i < n; i++) {
    const dx = xw[i]! - mx;
    const dy = yw[i]! - my;
    const dz = z[i]! - mz;
    sxx += dx * dx;
    sxy += dx * dy;
    sxz += dx * dz;
    syy += dy * dy;
    syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) <= DET_EPS) return Infinity;
  const a = (sxz * syy - syz * sxy) / det;
  const b = (sxx * syz - sxy * sxz) / det;
  const c = mz - a * mx - b * my;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const pred = a * xw[i]! + b * yw[i]! + c;
    maxD = Math.max(maxD, Math.abs(z[i]! - pred));
  }
  return maxD;
}

/** À appeler après `applyRoofVertexHeightEdit` sur le même `edit`. */
export function rebuildPanPlanarHeightsAfterZEdit(
  runtime: unknown,
  edit: RoofVertexHeightEdit,
): RebuildPanPlanarHeightsAfterZEditResult {
  if (!runtime || typeof runtime !== "object") {
    return { ok: false, code: "RUNTIME_MISSING", message: "Runtime absent ou invalide." };
  }
  const root = runtime as Record<string, unknown>;
  const frame = readMppAndNorth(root);
  if (!frame) {
    return { ok: false, code: "WORLD_FRAME_MISSING", message: "Échelle (metersPerPixel) absente pour le repère monde." };
  }
  const pans = root.pans;
  if (!Array.isArray(pans)) {
    return { ok: false, code: "PANS_MISSING", message: "state.pans absent ou non tableau." };
  }
  const panId = String(edit.panId);
  const panRec = pans.find((p) => p && typeof p === "object" && String((p as Record<string, unknown>).id) === panId);
  if (!panRec || typeof panRec !== "object") {
    return { ok: false, code: "PAN_NOT_FOUND", message: `Aucun pan id « ${panId} » dans state.pans.` };
  }
  const poly = resolveCalpinagePanPolygonPointsForHeightEdit(panRec as Record<string, unknown>);
  if (!poly) {
    return { ok: false, code: "PAN_POLYGON_MISSING", message: "Polygone pan introuvable." };
  }
  const n = poly.points.length;
  if (n < 3 || edit.vertexIndex < 0 || edit.vertexIndex >= n) {
    return { ok: false, code: "VERTEX_OR_POLY_INVALID", message: "Polygone ou index sommet invalide." };
  }

  const xw: number[] = new Array(n);
  const yw: number[] = new Array(n);
  const zPrior: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const pt = poly.points[i]!;
    const px = readPointPx(pt);
    if (!px) {
      return { ok: false, code: "VERTEX_XY_INVALID", message: `Sommet ${i} : x/y image invalides.` };
    }
    const wh = imagePxToWorldHorizontalM(px.x, px.y, frame.mpp, frame.northAngleDeg);
    xw[i] = wh.x;
    yw[i] = wh.y;
    const z = readVertexHeightM(pt);
    if (z == null) {
      return { ok: false, code: "VERTEX_Z_MISSING", message: `Sommet ${i} : hauteur (h / heightM) absente.` };
    }
    zPrior[i] = z;
  }

  const e = edit.vertexIndex;
  const zE = zPrior[e]!;
  if (!Number.isFinite(zE) || Math.abs(zE - edit.heightM) > 1e-6) {
    return {
      ok: false,
      code: "EDIT_HEIGHT_MISMATCH",
      message: "Appeler applyRoofVertexHeightEdit avant la reconstruction planaire.",
    };
  }

  if (maxCoplanarDeviationM(xw, yw, zPrior) <= COPLANAR_SKIP_MAX_DEVIATION_M) {
    return { ok: true };
  }

  const xE = xw[e]!;
  const yE = yw[e]!;

  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    if (i === e) continue;
    const wgt = neighborWeight(n, e, i);
    const dx = xw[i]! - xE;
    const dy = yw[i]! - yE;
    const r = zPrior[i]! - zE;
    a11 += wgt * dx * dx;
    a12 += wgt * dx * dy;
    a22 += wgt * dy * dy;
    b1 += wgt * dx * r;
    b2 += wgt * dy * r;
  }

  let a = 0;
  let b = 0;
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) > DET_EPS) {
    a = (b1 * a22 - b2 * a12) / det;
    b = (a11 * b2 - a12 * b1) / det;
  }

  const zNew: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    zNew[i] = a * (xw[i]! - xE) + b * (yw[i]! - yE) + zE;
  }

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(zNew[i])) {
      return { ok: false, code: "NAN_HEIGHT", message: "Hauteur reconstruite non finie." };
    }
    if (!isValidBuildingHeightM(zNew[i]!)) {
      return {
        ok: false,
        code: "HEIGHT_OUT_OF_RANGE",
        message: "Après reconstruction, une hauteur sort de la plage autorisée.",
      };
    }
  }

  for (let i = 0; i < n; i++) {
    const pt = poly.points[i]!;
    pt.h = zNew[i]!;
    if ("heightM" in pt) {
      delete pt.heightM;
    }
  }

  const panObj = panRec as Record<string, unknown>;
  if (poly.points === panObj.points) {
    syncPolygonPxFromPoints(panObj);
  } else if (poly.points === panObj.polygonPx) {
    syncPointsFromPolygonPx(panObj);
  }

  return { ok: true };
}
