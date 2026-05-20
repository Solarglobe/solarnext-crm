import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofExtensionV1, RoofExtensionPointPxV1 } from "./roofExtensionV1";
import type { RoofExtensionWorldMapping } from "./resolveSupportPan";

export interface RoofExtensionV1ValidationInput extends RoofExtensionWorldMapping {
  readonly model: RoofExtensionV1;
  readonly supportPatch: RoofPlanePatch3D | null;
}

const EPS = 1e-7;
const SUPPORT_TOL_M = 0.02;

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function signedArea(points: readonly { readonly x: number; readonly y: number }[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function orient(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  c: { readonly x: number; readonly y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(
  p: { readonly x: number; readonly y: number },
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  tol = EPS,
): boolean {
  const cross = Math.abs(orient(a, b, p));
  if (cross > tol) return false;
  const dot = (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y);
  return dot <= tol;
}

function segmentsIntersect(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
  c: { readonly x: number; readonly y: number },
  d: { readonly x: number; readonly y: number },
): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (Math.abs(o1) <= EPS && pointOnSegment(c, a, b)) return true;
  if (Math.abs(o2) <= EPS && pointOnSegment(d, a, b)) return true;
  if (Math.abs(o3) <= EPS && pointOnSegment(a, c, d)) return true;
  if (Math.abs(o4) <= EPS && pointOnSegment(b, c, d)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function polygonIsSimple(points: readonly RoofExtensionPointPxV1[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    for (let j = i + 1; j < points.length; j++) {
      const adjacent = j === i || j === (i + 1) % points.length || i === (j + 1) % points.length;
      if (adjacent) continue;
      const c = points[j]!;
      const d = points[(j + 1) % points.length]!;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function pointInPolygonOrOnEdge(
  point: { readonly x: number; readonly y: number },
  polygon: readonly { readonly x: number; readonly y: number }[],
  tol = EPS,
): boolean {
  if (polygon.some((p, i) => pointOnSegment(point, p, polygon[(i + 1) % polygon.length]!, tol))) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const crosses =
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function finitePoint(p: RoofExtensionPointPxV1): boolean {
  return finite(p.x) && finite(p.y) && finite(p.heightRelM);
}

function pushDiag(
  diagnostics: GeometryDiagnostic[],
  code: string,
  severity: GeometryDiagnostic["severity"],
  message: string,
  extensionId: string,
  extra?: Readonly<Record<string, string | number | boolean>>,
): void {
  diagnostics.push({
    code,
    severity,
    message,
    context: { extensionId, ...(extra ?? {}) },
  });
}

export function validateRoofExtensionV1(input: RoofExtensionV1ValidationInput): readonly GeometryDiagnostic[] {
  const { model, supportPatch } = input;
  const diagnostics: GeometryDiagnostic[] = [];

  if (model.version !== "roof_extension_v1") {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_VERSION_INVALID", "error", "Version canonique extension invalide.", model.id);
  }
  if (!model.id) pushDiag(diagnostics, "ROOF_EXTENSION_V1_ID_MISSING", "error", "Id extension manquant.", model.id);
  if (!model.supportPanId) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_SUPPORT_REQUIRED", "error", "supportPanId obligatoire absent.", model.id);
  }
  if (!supportPatch) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_SUPPORT_PATCH_MISSING", "error", "Pan support canonique introuvable.", model.id);
  } else if (String(supportPatch.id) !== model.supportPanId) {
    pushDiag(
      diagnostics,
      "ROOF_EXTENSION_V1_SUPPORT_PATCH_MISMATCH",
      "error",
      "Le supportPanId canonique ne correspond pas au pan support resolu.",
      model.id,
      { supportPanId: model.supportPanId, resolvedSupportPanId: String(supportPatch.id) },
    );
  }

  if (model.footprintPx.length < 3) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_FOOTPRINT_TOO_SMALL", "error", "Footprint extension trop court.", model.id);
  }
  if (!model.footprintPx.every(finitePoint) || !finitePoint(model.ridgePx.a) || !finitePoint(model.ridgePx.b)) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_NON_FINITE_POINT", "error", "Point extension NaN/Infinity.", model.id);
  }

  const area = signedArea(model.footprintPx);
  if (Math.abs(area) < EPS) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_FOOTPRINT_AREA_ZERO", "error", "Footprint extension d'aire nulle.", model.id);
  }
  if ((area > 0 ? "counter_clockwise" : "clockwise") !== model.footprintWinding) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_WINDING_MISMATCH", "error", "Winding canonique incoherent avec le footprint.", model.id);
  }
  if (!polygonIsSimple(model.footprintPx)) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_FOOTPRINT_SELF_INTERSECTION", "error", "Footprint extension auto-intersectant.", model.id);
  }

  const ridgeLen = Math.hypot(model.ridgePx.a.x - model.ridgePx.b.x, model.ridgePx.a.y - model.ridgePx.b.y);
  if (ridgeLen < EPS) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_RIDGE_DEGENERATE", "error", "Faitage extension de longueur nulle.", model.id);
  }
  if (!pointInPolygonOrOnEdge(model.ridgePx.a, model.footprintPx) || !pointInPolygonOrOnEdge(model.ridgePx.b, model.footprintPx)) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_RIDGE_OUTSIDE_FOOTPRINT", "error", "Faitage hors footprint extension.", model.id);
  }

  const heights = [
    model.dimensions.wallHeightM,
    model.dimensions.roofHeightM,
    model.dimensions.totalHeightM,
    model.ridgePx.a.heightRelM,
    model.ridgePx.b.heightRelM,
    ...model.footprintPx.map((p) => p.heightRelM),
  ];
  if (heights.some((h) => !finite(h) || h < 0)) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_HEIGHT_INVALID", "error", "Hauteur extension invalide.", model.id);
  }
  if (model.dimensions.totalHeightM + EPS < model.dimensions.wallHeightM) {
    pushDiag(diagnostics, "ROOF_EXTENSION_V1_HEIGHT_ORDER_INVALID", "error", "Hauteur totale inferieure a la hauteur de mur.", model.id);
  }

  if (supportPatch) {
    const supportPoly = supportPatch.cornersWorld.map((p) => ({ x: p.x, y: p.y }));
    for (const p of model.footprintPx) {
      const world = imagePxToWorldHorizontalM(p.x, p.y, input.metersPerPixel, input.northAngleDeg);
      if (!pointInPolygonOrOnEdge(world, supportPoly, SUPPORT_TOL_M)) {
        pushDiag(
          diagnostics,
          "ROOF_EXTENSION_V1_FOOTPRINT_OUTSIDE_SUPPORT",
          "warning",
          "Footprint extension hors enveloppe XY du pan support resolu ; garde en warning pendant la migration legacy.",
          model.id,
          { supportPanId: model.supportPanId },
        );
        break;
      }
    }
  }

  if (model.provenance.inferredSupportPanId) {
    pushDiag(
      diagnostics,
      "ROOF_EXTENSION_V1_SUPPORT_INFERRED_FROM_LEGACY",
      "warning",
      "supportPanId canonique infere depuis la position legacy ; a persister lors de la prochaine sauvegarde.",
      model.id,
      { supportPanId: model.supportPanId },
    );
  }

  if (diagnostics.length === 0) {
    pushDiag(
      diagnostics,
      "ROOF_EXTENSION_V1_VALID",
      "info",
      "Extension toiture canonique V1 validee.",
      model.id,
      { supportPanId: model.supportPanId },
    );
  }
  return diagnostics;
}

export function roofExtensionV1HasBlockingErrors(diagnostics: readonly GeometryDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
