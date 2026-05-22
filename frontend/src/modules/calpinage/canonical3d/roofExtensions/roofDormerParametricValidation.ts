import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import { dot3, isFiniteVec3, length3, normalize3, sub3 } from "../utils/math3";
import type {
  RoofDormerParametricFootprint,
  RoofDormerParametricModel,
  RoofDormerParametricPoint2D,
} from "./roofDormerParametricModel";

const EPS = 1e-6;

function diag(
  code: string,
  severity: GeometryDiagnostic["severity"],
  message: string,
  extensionId: string,
): GeometryDiagnostic {
  return { code, severity, message, context: { extensionId } };
}

function finitePoint(p: RoofDormerParametricPoint2D): boolean {
  return Number.isFinite(p.uM) && Number.isFinite(p.vM);
}

export function roofDormerParametricFootprintCycle(
  footprint: RoofDormerParametricFootprint,
): readonly RoofDormerParametricPoint2D[] {
  return [footprint.frontLeft, footprint.frontRight, footprint.rearRight, footprint.rearLeft];
}

function signedArea(points: readonly RoofDormerParametricPoint2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.uM * b.vM - b.uM * a.vM;
  }
  return sum / 2;
}

function orientation(a: RoofDormerParametricPoint2D, b: RoofDormerParametricPoint2D, c: RoofDormerParametricPoint2D): number {
  return (b.uM - a.uM) * (c.vM - a.vM) - (b.vM - a.vM) * (c.uM - a.uM);
}

function segmentsIntersect(
  a: RoofDormerParametricPoint2D,
  b: RoofDormerParametricPoint2D,
  c: RoofDormerParametricPoint2D,
  d: RoofDormerParametricPoint2D,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < -EPS && o3 * o4 < -EPS;
}

function polygonSimple(points: readonly RoofDormerParametricPoint2D[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % points.length]!;
    for (let j = i + 1; j < points.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j]!;
      const b2 = points[(j + 1) % points.length]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function pointInConvexQuad(p: RoofDormerParametricPoint2D, quad: readonly RoofDormerParametricPoint2D[]): boolean {
  const area = signedArea(quad);
  if (Math.abs(area) < EPS) return false;
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < quad.length; i++) {
    if (orientation(quad[i]!, quad[(i + 1) % quad.length]!, p) * sign < -EPS) return false;
  }
  return true;
}

function distancePointToSegmentM(
  p: RoofDormerParametricPoint2D,
  a: RoofDormerParametricPoint2D,
  b: RoofDormerParametricPoint2D,
): number {
  const abU = b.uM - a.uM;
  const abV = b.vM - a.vM;
  const len2 = abU * abU + abV * abV;
  if (len2 < EPS * EPS) return Math.hypot(p.uM - a.uM, p.vM - a.vM);
  const t = Math.max(0, Math.min(1, ((p.uM - a.uM) * abU + (p.vM - a.vM) * abV) / len2));
  return Math.hypot(p.uM - (a.uM + abU * t), p.vM - (a.vM + abV * t));
}

export function validateRoofDormerParametricModel(
  model: RoofDormerParametricModel,
  supportPatch?: RoofPlanePatch3D | null,
): readonly GeometryDiagnostic[] {
  const diagnostics: GeometryDiagnostic[] = [];
  if (model.version !== "roof_dormer_parametric_v1") {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_VERSION_INVALID", "error", "Version parametric dormer invalide.", model.id));
  }
  if (!model.id || !model.supportPanId) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_ID_INVALID", "error", "ID ou supportPanId manquant.", model.id || "unknown"));
  }
  if (!isFiniteVec3(model.anchorWorld)) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_ANCHOR_INVALID", "error", "Ancre monde invalide.", model.id));
  }
  const uAxis = normalize3(model.orientation.uAxisWorld);
  const vAxis = normalize3(model.orientation.vAxisWorld);
  if (!uAxis || !vAxis) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_ORIENTATION_INVALID", "error", "Orientation dormer invalide.", model.id));
  } else {
    if (Math.abs(dot3(uAxis, vAxis)) > 1e-3) {
      diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_ORIENTATION_NOT_ORTHOGONAL", "error", "Axes parametriques non orthogonaux.", model.id));
    }
    if (supportPatch && (Math.abs(dot3(uAxis, supportPatch.normal)) > 1e-3 || Math.abs(dot3(vAxis, supportPatch.normal)) > 1e-3)) {
      diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_ORIENTATION_OFF_PLANE", "warning", "Axes parametriques non tangents au pan support.", model.id));
    }
  }
  if (supportPatch && supportPatch.id !== model.supportPanId) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_SUPPORT_MISMATCH", "error", "Le pan support ne correspond pas au modele.", model.id));
  }
  if (supportPatch && Math.abs(dot3(supportPatch.normal, model.anchorWorld) + supportPatch.equation.d) > 0.25) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_ANCHOR_OFF_PLANE", "warning", "Ancre eloignee du pan support avant projection.", model.id));
  }

  const points = roofDormerParametricFootprintCycle(model.footprint);
  if (!points.every(finitePoint) || !finitePoint(model.ridge.front) || !finitePoint(model.ridge.rear)) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_COORD_INVALID", "error", "Coordonnees locales invalides.", model.id));
  }
  const area = signedArea(points);
  if (Math.abs(area) < 0.05) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_FOOTPRINT_DEGENERATE", "error", "Empreinte dormer degeneree.", model.id));
  }
  if (!polygonSimple(points)) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_FOOTPRINT_SELF_INTERSECT", "error", "Empreinte dormer auto-intersectee.", model.id));
  }
  if (!pointInConvexQuad(model.ridge.front, points) || !pointInConvexQuad(model.ridge.rear, points)) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_RIDGE_OUTSIDE", "error", "Faitage hors empreinte controlee.", model.id));
  }
  const ridgeLen = Math.hypot(model.ridge.rear.uM - model.ridge.front.uM, model.ridge.rear.vM - model.ridge.front.vM);
  if (ridgeLen < 0.2) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_RIDGE_TOO_SHORT", "error", "Faitage trop court.", model.id));
  }
  const frontDist = distancePointToSegmentM(model.ridge.front, model.footprint.frontLeft, model.footprint.frontRight);
  const rearDist = distancePointToSegmentM(model.ridge.rear, model.footprint.rearLeft, model.footprint.rearRight);
  if (frontDist > 0.35 || rearDist > 0.35) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_RIDGE_ENDPOINT_UNALIGNED", "warning", "Le faitage n'est pas raccorde proprement aux facades.", model.id));
  }

  const h = model.heights;
  if (
    h.reference !== "support_plane_normal" ||
    !Number.isFinite(h.facadeHeightM) ||
    !Number.isFinite(h.ridgeHeightM) ||
    !Number.isFinite(h.roofRiseM) ||
    h.facadeHeightM < 0 ||
    h.ridgeHeightM < 0 ||
    h.roofRiseM < 0
  ) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_HEIGHT_INVALID", "error", "Hauteurs dormer invalides.", model.id));
  }
  if (Math.abs(h.ridgeHeightM - h.facadeHeightM - h.roofRiseM) > 1e-5) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_HEIGHT_CONFLICT", "error", "ridgeHeightM doit egaler facadeHeightM + roofRiseM.", model.id));
  }
  if (h.facadeHeightM < 0.05 || h.ridgeHeightM < 0.1) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_HEIGHT_TOO_LOW", "warning", "Hauteur dormer tres faible.", model.id));
  }
  if (supportPatch && length3(sub3(supportPatch.localFrame.zAxis, supportPatch.normal)) > 1e-3) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_SUPPORT_FRAME_WARNING", "warning", "Repere local du pan non aligne avec sa normale.", model.id));
  }
  return diagnostics;
}

export function roofDormerParametricHasBlockingErrors(diagnostics: readonly GeometryDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
