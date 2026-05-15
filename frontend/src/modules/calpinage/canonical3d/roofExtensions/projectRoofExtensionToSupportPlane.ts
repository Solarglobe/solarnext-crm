import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { WorldPosition3D } from "../types/coordinates";
import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { Vector3 } from "../types/primitives";
import { add3, normalize3, scale3 } from "../utils/math3";
import { zOnPlaneEquationAtFixedXY } from "../volumes/planeAnchor";
import type {
  RoofExtensionSource2D,
  RoofExtensionSourcePoint2D,
  RoofExtensionSourceSegment2D,
} from "./roofExtensionSource";
import type { RoofExtensionWorldMapping } from "./resolveSupportPan";

export interface ProjectedRoofExtensionPoint3D {
  readonly source: RoofExtensionSourcePoint2D;
  readonly base: WorldPosition3D;
  readonly top: WorldPosition3D;
  readonly heightRelM: number;
}

export interface ProjectedRoofExtensionSegment3D {
  readonly a: ProjectedRoofExtensionPoint3D;
  readonly b: ProjectedRoofExtensionPoint3D;
}

export interface ProjectedRoofExtensionGeometry {
  readonly supportNormal: Vector3;
  readonly contour: readonly ProjectedRoofExtensionPoint3D[];
  readonly ridge: ProjectedRoofExtensionSegment3D;
  readonly maxHeightRelM: number;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

function supportNormalFromPatch(patch: RoofPlanePatch3D): Vector3 | null {
  const n = normalize3(patch.normal);
  if (!n) return null;
  return n.z < 0 ? { x: -n.x, y: -n.y, z: -n.z } : n;
}

function heightOrDefault(value: number | null, fallback: number): number {
  if (value != null && Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

function projectSourcePoint(
  point: RoofExtensionSourcePoint2D,
  heightRelM: number,
  patch: RoofPlanePatch3D,
  normal: Vector3,
  world: RoofExtensionWorldMapping,
): ProjectedRoofExtensionPoint3D | null {
  const xy = imagePxToWorldHorizontalM(point.x, point.y, world.metersPerPixel, world.northAngleDeg);
  const z = zOnPlaneEquationAtFixedXY(patch.equation, xy.x, xy.y);
  if (z == null) return null;
  const base = { x: xy.x, y: xy.y, z };
  const top = add3(base, scale3(normal, heightRelM));
  return {
    source: point,
    base,
    top: { x: top.x, y: top.y, z: top.z },
    heightRelM,
  };
}

function projectSegment(
  segment: RoofExtensionSourceSegment2D,
  source: RoofExtensionSource2D,
  patch: RoofPlanePatch3D,
  normal: Vector3,
  world: RoofExtensionWorldMapping,
): ProjectedRoofExtensionSegment3D | null {
  const fallbackHeight = heightOrDefault(source.ridgeHeightRelM, 1);
  const aHeight = heightOrDefault(segment.a.heightRelM, fallbackHeight);
  const bHeight = heightOrDefault(segment.b.heightRelM, fallbackHeight);
  const a = projectSourcePoint(segment.a, aHeight, patch, normal, world);
  const b = projectSourcePoint(segment.b, bHeight, patch, normal, world);
  if (!a || !b) return null;
  return { a, b };
}

export function projectRoofExtensionToSupportPlane(
  source: RoofExtensionSource2D,
  patch: RoofPlanePatch3D,
  world: RoofExtensionWorldMapping,
): ProjectedRoofExtensionGeometry | null {
  const diagnostics: GeometryDiagnostic[] = [];
  const normal = supportNormalFromPatch(patch);
  if (!normal) {
    return null;
  }
  if (!source.ridge) {
    return null;
  }

  const contour = source.contour.flatMap((point) => {
    const projected = projectSourcePoint(point, heightOrDefault(point.heightRelM, 0), patch, normal, world);
    if (!projected) {
      diagnostics.push({
        code: "ROOF_EXTENSION_CONTOUR_POINT_PROJECTION_FAILED",
        severity: "warning",
        message: `Extension ${source.id} : un sommet de contour ne peut pas etre projete sur le pan support.`,
        context: { extensionId: source.id },
      });
      return [];
    }
    return [projected];
  });
  if (contour.length < 3) return null;

  const ridge = projectSegment(source.ridge, source, patch, normal, world);
  if (!ridge) return null;

  const maxHeightRelM = Math.max(
    0,
    ...contour.map((p) => p.heightRelM),
    ridge.a.heightRelM,
    ridge.b.heightRelM,
  );

  diagnostics.push({
    code: "ROOF_EXTENSION_HEIGHT_REFERENCE_SUPPORT_NORMAL",
    severity: "info",
    message: `Extension ${source.id} : hauteurs appliquees selon la normale du pan support.`,
    context: { extensionId: source.id, supportPanId: patch.id, maxHeightRelM },
  });

  return {
    supportNormal: normal,
    contour,
    ridge,
    maxHeightRelM,
    diagnostics,
  };
}
