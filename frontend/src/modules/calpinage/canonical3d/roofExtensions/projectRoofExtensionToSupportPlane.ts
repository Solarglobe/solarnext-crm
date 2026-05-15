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
import { ridgeEndpointSharesApexVertex } from "./roofExtensionSource";
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
  /** Sommet partagé projeté ; même base/top que l’extrémité du faîtage qui coïncide en 2D */
  readonly apex: ProjectedRoofExtensionPoint3D | null;
  readonly apexTopVertexId: string | null;
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

function projectRidgeEndpointWithApexMerge(
  endpoint: RoofExtensionSourcePoint2D,
  source: RoofExtensionSource2D,
  apexProj: ProjectedRoofExtensionPoint3D | null,
  fallbackHeight: number,
  patch: RoofPlanePatch3D,
  normal: Vector3,
  world: RoofExtensionWorldMapping,
): ProjectedRoofExtensionPoint3D | null {
  if (
    apexProj &&
    source.apexVertex &&
    ridgeEndpointSharesApexVertex(endpoint, source.apexVertex)
  ) {
    return apexProj;
  }
  const h = heightOrDefault(endpoint.heightRelM, fallbackHeight);
  return projectSourcePoint(endpoint, h, patch, normal, world);
}

function buildProjectedRidgeSegment(
  segment: RoofExtensionSourceSegment2D,
  source: RoofExtensionSource2D,
  apexProj: ProjectedRoofExtensionPoint3D | null,
  patch: RoofPlanePatch3D,
  normal: Vector3,
  world: RoofExtensionWorldMapping,
): ProjectedRoofExtensionSegment3D | null {
  const fallbackHeight = heightOrDefault(source.ridgeHeightRelM, 1);
  const a = projectRidgeEndpointWithApexMerge(segment.a, source, apexProj, fallbackHeight, patch, normal, world);
  const b = projectRidgeEndpointWithApexMerge(segment.b, source, apexProj, fallbackHeight, patch, normal, world);
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

  const fallbackRidgeH = heightOrDefault(source.ridgeHeightRelM, 1);
  const apexPilotH = heightOrDefault(
    source.apexVertex != null && typeof source.apexVertex.h === "number"
      ? source.apexVertex.h
      : null,
    fallbackRidgeH,
  );
  let apexProj: ProjectedRoofExtensionPoint3D | null = null;
  let apexTopVertexId: string | null = null;
  if (source.apexVertex) {
    apexTopVertexId = source.apexVertex.id;
    apexProj = projectSourcePoint(
      { x: source.apexVertex.x, y: source.apexVertex.y, heightRelM: apexPilotH },
      apexPilotH,
      patch,
      normal,
      world,
    );
    if (!apexProj) {
      diagnostics.push({
        code: "ROOF_EXTENSION_APEX_PROJECTION_FAILED",
        severity: "warning",
        message: `Extension ${source.id} : apex non projetable sur le pan support.`,
        context: { extensionId: source.id },
      });
    }
  }

  const ridge = source.ridge
    ? buildProjectedRidgeSegment(source.ridge, source, apexProj, patch, normal, world)
    : null;
  if (!ridge) return null;

  const maxHeightRelM = Math.max(
    0,
    ...contour.map((p) => p.heightRelM),
    ridge.a.heightRelM,
    ridge.b.heightRelM,
    apexProj?.heightRelM ?? 0,
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
    apex: apexProj,
    apexTopVertexId,
    maxHeightRelM,
    diagnostics,
  };
}
