import { projectPointToPlaneUv } from "../builder/planePolygon3d";
import type { LocalFrame3D } from "../types/frame";
import type { GeometryDiagnostic, GeometryTruthStatus } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { SolarScene3D } from "../types/solarScene3d";
import type { Vector3 } from "../types/primitives";
import { cross3, dot3, isFiniteVec3, length3, normalize3, scale3, sub3 } from "../utils/math3";
import { signedArea2d, triangulateSimplePolygon2dCcW } from "../utils/triangulateSimplePolygon2d";

export type TriangulationTruthMethod =
  | "TRIANGULATION_EXACT"
  | "TRIANGULATION_FALLBACK_XY"
  | "TRIANGULATION_FALLBACK_FAN"
  | "TRIANGULATION_INVALID";

export interface Polygon2DValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly GeometryDiagnostic[];
  readonly areaAbsM2: number;
  readonly selfIntersectionCount: number;
}

export interface LocalFrameValidationResult {
  readonly ok: boolean;
  readonly recoverable: boolean;
  readonly frame: LocalFrame3D | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export interface RoofPatchTriangulationTruth {
  readonly patchId: string;
  readonly status: GeometryTruthStatus;
  readonly method: TriangulationTruthMethod;
  readonly indices: readonly number[];
  readonly diagnostics: readonly GeometryDiagnostic[];
  readonly polygonAreaM2: number;
  readonly meshAreaM2: number;
  readonly areaDeltaM2: number;
  readonly triangleCount: number;
  readonly invertedTriangleCount: number;
  readonly degenerateTriangleCount: number;
  readonly triangleCentroidsOutsideCount: number;
}

export interface RoofPatchGeometryTruth {
  readonly patchId: string;
  readonly status: GeometryTruthStatus;
  readonly diagnostics: readonly GeometryDiagnostic[];
  readonly normalizedLocalFrame: LocalFrame3D | null;
  readonly triangulation: RoofPatchTriangulationTruth;
}

export interface SolarSceneGeometryTruth {
  readonly status: GeometryTruthStatus;
  readonly patchTruth: readonly RoofPatchGeometryTruth[];
  readonly diagnostics: readonly GeometryDiagnostic[];
}

type Point2 = { readonly x: number; readonly y: number };

const EPS = 1e-9;
const EDGE_EPS_M = 1e-6;
const AREA_EPS_M2 = 1e-6;
const SURFACE_AREA_EPS_M2 = 1e-4;
const SURFACE_AREA_RELATIVE_EPS = 1e-4;
const FRAME_UNIT_EPS = 1e-4;
const FRAME_DOT_EPS = 1e-4;
const TRIANGLE_AREA_EPS_M2 = 1e-8;

function diag(
  code: string,
  severity: GeometryDiagnostic["severity"],
  message: string,
  context?: Readonly<Record<string, string | number | boolean>>,
): GeometryDiagnostic {
  return context ? { code, severity, message, context } : { code, severity, message };
}

function pointKey(p: Point2): string {
  return `${p.x.toFixed(9)}:${p.y.toFixed(9)}`;
}

function pointDistance2(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersectStrict(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < -EPS && o3 * o4 < -EPS;
}

function countSelfIntersections(poly: readonly Point2[]): number {
  let count = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    for (let j = i + 1; j < poly.length; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === poly.length - 1)) continue;
      const c = poly[j]!;
      const d = poly[(j + 1) % poly.length]!;
      if (segmentsIntersectStrict(a, b, c, d)) count++;
    }
  }
  return count;
}

function pointInPolygon2D(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (pi.y > point.y !== pj.y > point.y) {
      const xAtY = ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
      if (point.x < xAtY) inside = !inside;
    }
  }
  return inside;
}

function triangleArea3D(a: Vector3, b: Vector3, c: Vector3): number {
  return length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
}

export function validateSimplePolygon2D(
  polygon: readonly Point2[],
  contextLabel = "polygon",
): Polygon2DValidationResult {
  const diagnostics: GeometryDiagnostic[] = [];

  if (polygon.length < 3) {
    diagnostics.push(diag("POLYGON_TOO_FEW_VERTICES", "error", `${contextLabel} : moins de 3 sommets`, { vertexCount: polygon.length }));
  }

  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      diagnostics.push(diag("POLYGON_NON_FINITE_COORDINATE", "error", `${contextLabel} : coordonnée non finie`, { index: i }));
    }
  }

  const seen = new Set<string>();
  for (let i = 0; i < polygon.length; i++) {
    const key = pointKey(polygon[i]!);
    if (seen.has(key)) {
      diagnostics.push(diag("POLYGON_DUPLICATE_VERTEX", "error", `${contextLabel} : sommet dupliqué`, { index: i }));
    }
    seen.add(key);
  }
  if (seen.size < 3) {
    diagnostics.push(diag("POLYGON_NOT_ENOUGH_DISTINCT_VERTICES", "error", `${contextLabel} : sommets distincts insuffisants`));
  }

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const len = pointDistance2(a, b);
    if (!Number.isFinite(len) || len <= EDGE_EPS_M) {
      diagnostics.push(diag("POLYGON_ZERO_LENGTH_EDGE", "error", `${contextLabel} : segment quasi nul`, { edgeIndex: i, lengthM: len }));
    }
  }

  const areaAbsM2 = Math.abs(signedArea2d(polygon));
  if (!Number.isFinite(areaAbsM2) || areaAbsM2 <= AREA_EPS_M2) {
    diagnostics.push(diag("POLYGON_DEGENERATE_AREA", "error", `${contextLabel} : aire nulle ou quasi nulle`, { areaM2: areaAbsM2 }));
  }

  const selfIntersectionCount = countSelfIntersections(polygon);
  if (selfIntersectionCount > 0) {
    diagnostics.push(
      diag("POLYGON_SELF_INTERSECTION", "error", `${contextLabel} : polygone auto-croisé`, { selfIntersectionCount }),
    );
  }

  return {
    ok: diagnostics.every((d) => d.severity !== "error"),
    diagnostics,
    areaAbsM2,
    selfIntersectionCount,
  };
}

export function validateAndNormalizeLocalFrame(
  frame: LocalFrame3D,
  expectedNormal?: Vector3,
  contextLabel = "localFrame",
): LocalFrameValidationResult {
  const diagnostics: GeometryDiagnostic[] = [];
  const originOk = isFiniteVec3(frame.origin);
  const x0 = normalize3(frame.xAxis);
  const z0 = normalize3(expectedNormal ?? frame.zAxis);
  if (!originOk) diagnostics.push(diag("LOCAL_FRAME_NON_FINITE_ORIGIN", "error", `${contextLabel} : origine non finie`));
  if (!x0) diagnostics.push(diag("LOCAL_FRAME_INVALID_X_AXIS", "error", `${contextLabel} : axe X nul ou non fini`));
  if (!z0) diagnostics.push(diag("LOCAL_FRAME_INVALID_Z_AXIS", "error", `${contextLabel} : axe Z nul ou non fini`));
  if (!originOk || !x0 || !z0) {
    return { ok: false, recoverable: false, frame: null, diagnostics };
  }

  const xProjected = normalize3(sub3(x0, scale3(z0, dot3(x0, z0))));
  if (!xProjected) {
    diagnostics.push(diag("LOCAL_FRAME_X_PARALLEL_TO_NORMAL", "error", `${contextLabel} : axe X parallèle à la normale`));
    return { ok: false, recoverable: false, frame: null, diagnostics };
  }

  const yAxis = normalize3(cross3(z0, xProjected));
  if (!yAxis) {
    diagnostics.push(diag("LOCAL_FRAME_CANNOT_BUILD_Y_AXIS", "error", `${contextLabel} : axe Y impossible à reconstruire`));
    return { ok: false, recoverable: false, frame: null, diagnostics };
  }
  const xAxis = normalize3(cross3(yAxis, z0)) ?? xProjected;
  const normalized: LocalFrame3D = {
    role: frame.role,
    origin: { ...frame.origin },
    xAxis,
    yAxis,
    zAxis: z0,
  };

  const rawIsUnit =
    Math.abs(length3(frame.xAxis) - 1) <= FRAME_UNIT_EPS &&
    Math.abs(length3(frame.yAxis) - 1) <= FRAME_UNIT_EPS &&
    Math.abs(length3(frame.zAxis) - 1) <= FRAME_UNIT_EPS;
  const rawIsOrthogonal =
    Math.abs(dot3(frame.xAxis, frame.yAxis)) <= FRAME_DOT_EPS &&
    Math.abs(dot3(frame.xAxis, frame.zAxis)) <= FRAME_DOT_EPS &&
    Math.abs(dot3(frame.yAxis, frame.zAxis)) <= FRAME_DOT_EPS;
  const rawHandednessOk = dot3(cross3(frame.xAxis, frame.yAxis), frame.zAxis) > 1 - FRAME_UNIT_EPS * 10;

  if (!rawIsUnit || !rawIsOrthogonal || !rawHandednessOk) {
    diagnostics.push(
      diag("LOCAL_FRAME_NORMALIZED", "info", `${contextLabel} : repère local normalisé sans changer l'orientation`, {
        rawIsUnit,
        rawIsOrthogonal,
        rawHandednessOk,
      }),
    );
  }

  return { ok: true, recoverable: true, frame: normalized, diagnostics };
}

export function normalizedLocalFrameForPatch(patch: RoofPlanePatch3D): LocalFrameValidationResult {
  return validateAndNormalizeLocalFrame(patch.localFrame, patch.normal, `pan ${patch.id}`);
}

export function projectPointToPatchUv(
  point: Vector3,
  patch: RoofPlanePatch3D,
): { readonly u: number; readonly v: number } | null {
  const frame = normalizedLocalFrameForPatch(patch).frame;
  if (!frame) return null;
  return projectPointToPlaneUv(point, frame.origin, frame.xAxis, frame.yAxis);
}

function uvPolygonForPatch(patch: RoofPlanePatch3D, normalizedFrame: LocalFrame3D): Point2[] {
  if (patch.polygon2DInPlane && patch.polygon2DInPlane.length === patch.cornersWorld.length) {
    return patch.polygon2DInPlane.map((p) => ({ x: p.u, y: p.v }));
  }
  return patch.cornersWorld.map((c) => {
    const uv = projectPointToPlaneUv(c, normalizedFrame.origin, normalizedFrame.xAxis, normalizedFrame.yAxis);
    return { x: uv.u, y: uv.v };
  });
}

function fanTriangulateIndices(n: number): number[] {
  const idx: number[] = [];
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
  return idx;
}

function orientIndicesToPatchNormal(
  indices: readonly number[],
  corners: readonly Vector3[],
  normal: Vector3,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!;
    const ib = indices[i + 1]!;
    const ic = indices[i + 2]!;
    const dotNormal = dot3(cross3(sub3(corners[ib]!, corners[ia]!), sub3(corners[ic]!, corners[ia]!)), normal);
    if (dotNormal >= 0) out.push(ia, ib, ic);
    else out.push(ia, ic, ib);
  }
  return out;
}

export function triangulateRoofPatchForMesh(patch: RoofPlanePatch3D): RoofPatchTriangulationTruth {
  const diagnostics: GeometryDiagnostic[] = [];
  const frameValidation = normalizedLocalFrameForPatch(patch);
  diagnostics.push(...frameValidation.diagnostics);
  if (!frameValidation.ok || !frameValidation.frame) {
    return {
      patchId: patch.id,
      status: "INVALID",
      method: "TRIANGULATION_INVALID",
      indices: [],
      diagnostics,
      polygonAreaM2: 0,
      meshAreaM2: 0,
      areaDeltaM2: 0,
      triangleCount: 0,
      invertedTriangleCount: 0,
      degenerateTriangleCount: 0,
      triangleCentroidsOutsideCount: 0,
    };
  }

  const polygon = uvPolygonForPatch(patch, frameValidation.frame);
  const polygonValidation = validateSimplePolygon2D(polygon, `pan ${patch.id}`);
  diagnostics.push(...polygonValidation.diagnostics);
  if (!polygonValidation.ok) {
    return {
      patchId: patch.id,
      status: "INVALID",
      method: "TRIANGULATION_INVALID",
      indices: [],
      diagnostics,
      polygonAreaM2: polygonValidation.areaAbsM2,
      meshAreaM2: 0,
      areaDeltaM2: polygonValidation.areaAbsM2,
      triangleCount: 0,
      invertedTriangleCount: 0,
      degenerateTriangleCount: 0,
      triangleCentroidsOutsideCount: 0,
    };
  }

  let order = Array.from({ length: polygon.length }, (_, i) => i);
  if (signedArea2d(order.map((i) => polygon[i]!)) < 0) order = order.slice().reverse();
  let raw = triangulateSimplePolygon2dCcW(order.map((i) => polygon[i]!));
  let method: TriangulationTruthMethod = "TRIANGULATION_EXACT";
  let indices: number[] | null = raw ? raw.map((i) => order[i]!) : null;

  if (!indices) {
    method = "TRIANGULATION_FALLBACK_XY";
    const xy = patch.cornersWorld.map((c) => ({ x: c.x, y: c.y }));
    const xyValidation = validateSimplePolygon2D(xy, `pan ${patch.id} worldXY fallback`);
    diagnostics.push(diag("TRIANGULATION_EXACT_FAILED", "warning", `Pan ${patch.id} : triangulation UV exacte impossible`));
    if (xyValidation.ok) {
      let xyOrder = Array.from({ length: xy.length }, (_, i) => i);
      if (signedArea2d(xyOrder.map((i) => xy[i]!)) < 0) xyOrder = xyOrder.slice().reverse();
      raw = triangulateSimplePolygon2dCcW(xyOrder.map((i) => xy[i]!));
      indices = raw ? raw.map((i) => xyOrder[i]!) : null;
    }
  }

  if (!indices) {
    method = "TRIANGULATION_FALLBACK_FAN";
    diagnostics.push(diag("TRIANGULATION_FALLBACK_FAN", "error", `Pan ${patch.id} : repli fan triangulation non fiable`));
    indices = fanTriangulateIndices(patch.cornersWorld.length);
  }

  indices = orientIndicesToPatchNormal(indices, patch.cornersWorld, patch.normal);
  let meshAreaM2 = 0;
  let invertedTriangleCount = 0;
  let degenerateTriangleCount = 0;
  let triangleCentroidsOutsideCount = 0;

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!;
    const ib = indices[i + 1]!;
    const ic = indices[i + 2]!;
    const a = patch.cornersWorld[ia]!;
    const b = patch.cornersWorld[ib]!;
    const c = patch.cornersWorld[ic]!;
    const area = triangleArea3D(a, b, c);
    meshAreaM2 += area;
    if (area <= TRIANGLE_AREA_EPS_M2) degenerateTriangleCount++;
    if (dot3(cross3(sub3(b, a), sub3(c, a)), patch.normal) < -EPS) invertedTriangleCount++;
    const centroid = {
      x: (polygon[ia]!.x + polygon[ib]!.x + polygon[ic]!.x) / 3,
      y: (polygon[ia]!.y + polygon[ib]!.y + polygon[ic]!.y) / 3,
    };
    if (!pointInPolygon2D(centroid, polygon)) triangleCentroidsOutsideCount++;
  }

  const areaDeltaM2 = Math.abs(meshAreaM2 - polygonValidation.areaAbsM2);
  const allowedSurfaceAreaDeltaM2 = Math.max(
    SURFACE_AREA_EPS_M2,
    polygonValidation.areaAbsM2 * SURFACE_AREA_RELATIVE_EPS,
  );
  if (areaDeltaM2 > allowedSurfaceAreaDeltaM2) {
    diagnostics.push(
      diag("TRIANGULATION_SURFACE_MISMATCH", "error", `Pan ${patch.id} : surface triangles incohérente`, {
        polygonAreaM2: polygonValidation.areaAbsM2,
        meshAreaM2,
        areaDeltaM2,
        allowedSurfaceAreaDeltaM2,
      }),
    );
  }
  if (degenerateTriangleCount > 0) {
    diagnostics.push(diag("TRIANGULATION_DEGENERATE_TRIANGLES", "error", `Pan ${patch.id} : triangles dégénérés`, { degenerateTriangleCount }));
  }
  if (invertedTriangleCount > 0) {
    diagnostics.push(diag("TRIANGULATION_INVERTED_TRIANGLES", "error", `Pan ${patch.id} : triangles inversés`, { invertedTriangleCount }));
  }
  if (triangleCentroidsOutsideCount > 0) {
    diagnostics.push(
      diag("TRIANGULATION_TRIANGLES_OUTSIDE_POLYGON", "error", `Pan ${patch.id} : triangles hors polygone`, {
        triangleCentroidsOutsideCount,
      }),
    );
  }

  const hasError = diagnostics.some((d) => d.severity === "error");
  const hasWarning = diagnostics.some((d) => d.severity === "warning");
  return {
    patchId: patch.id,
    status: hasError ? "INVALID" : hasWarning || method !== "TRIANGULATION_EXACT" ? "DEGRADED" : "VALID",
    method,
    indices,
    diagnostics,
    polygonAreaM2: polygonValidation.areaAbsM2,
    meshAreaM2,
    areaDeltaM2,
    triangleCount: indices.length / 3,
    invertedTriangleCount,
    degenerateTriangleCount,
    triangleCentroidsOutsideCount,
  };
}

export function evaluateRoofPatchGeometryTruth(patch: RoofPlanePatch3D): RoofPatchGeometryTruth {
  const frameValidation = normalizedLocalFrameForPatch(patch);
  const triangulation = triangulateRoofPatchForMesh(patch);
  const diagnostics = [...frameValidation.diagnostics, ...triangulation.diagnostics];
  const hasError = diagnostics.some((d) => d.severity === "error") || triangulation.status === "INVALID";
  const hasWarning = diagnostics.some((d) => d.severity === "warning") || triangulation.status === "DEGRADED";
  return {
    patchId: patch.id,
    status: hasError ? "INVALID" : hasWarning ? "DEGRADED" : "VALID",
    diagnostics,
    normalizedLocalFrame: frameValidation.frame,
    triangulation,
  };
}

export function evaluateSolarSceneGeometryTruth(scene: SolarScene3D): SolarSceneGeometryTruth {
  const patchTruth = scene.roofModel.roofPlanePatches.map(evaluateRoofPatchGeometryTruth);
  const diagnostics = patchTruth.flatMap((p) => p.diagnostics);
  let status: GeometryTruthStatus = "VALID";
  if (patchTruth.some((p) => p.status === "DEGRADED")) status = "DEGRADED";
  if (patchTruth.some((p) => p.status === "INVALID")) status = "INVALID";
  return { status, patchTruth, diagnostics };
}
