/**
 * Calcule le contexte spatial local d’un panneau (bord de pan, segments, volumes).
 */

import type { WorldPosition3D } from "../types/coordinates";
import type {
  PvPanelEdgeClearanceClass,
  PvPanelGeometricAnchorQuality,
  PvPanelPatchBoundaryContext3D,
  PvPanelSpatialContext3D,
  PvPanelSpatialContextQuality,
  PvPanelStructuralProximity3D,
  PvPanelStructuralSemantic,
  PvPanelVolumeOverlapLikelihood,
  PvPanelVolumeProximityContext3D,
} from "../types/pv-panel-context-3d";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { AxisAlignedBounds3D } from "../types/volumetric-mesh";
import type { Vector3 } from "../types/primitives";
import { add3, dot3, length3, scale3, sub3 } from "../utils/math3";
import type { PatchTangentBasis } from "./panelOnPlaneGeometry";
import { computePanelToPatchBoundaryMetrics2d } from "./polygonDistance2d";
import { pointInPolygon2d } from "./polygonDistance2d";
import type { StructuralLineSegment3D } from "./pvPanelInput";

const CRITICAL_M = 0.05;
const TIGHT_M = 0.15;
const MODERATE_M = 0.5;

function distancePointToSegment3D(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = sub3(b, a);
  const ap = sub3(p, a);
  const denom = dot3(ab, ab);
  const t = denom < 1e-18 ? 0 : dot3(ap, ab) / denom;
  const tc = Math.max(0, Math.min(1, t));
  const q = add3(a, scale3(ab, tc));
  return length3(sub3(p, q));
}

function worldToPlaneUv(
  p: WorldPosition3D,
  origin: Vector3,
  uHat: Vector3,
  vHat: Vector3
): { u: number; v: number } {
  const r = sub3(p, origin);
  return { u: dot3(r, uHat), v: dot3(r, vHat) };
}

function clearanceClass(d: number | null): PvPanelEdgeClearanceClass {
  if (d == null || !Number.isFinite(d)) return "unknown";
  if (d < CRITICAL_M) return "critical";
  if (d < TIGHT_M) return "tight";
  if (d < MODERATE_M) return "moderate";
  return "comfortable";
}

function distanceAabbToAabb(a: AxisAlignedBounds3D, b: AxisAlignedBounds3D): number {
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
  return Math.hypot(dx, dy, dz);
}

function aabbOverlap(a: AxisAlignedBounds3D, b: AxisAlignedBounds3D): boolean {
  return !(
    a.max.x < b.min.x ||
    b.max.x < a.min.x ||
    a.max.y < b.min.y ||
    b.max.y < a.min.y ||
    a.max.z < b.min.z ||
    b.max.z < a.min.z
  );
}

function orient2d(a: { u: number; v: number }, b: { u: number; v: number }, c: { u: number; v: number }): number {
  return (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
}

function pointOnSegment2d(
  p: { u: number; v: number },
  a: { u: number; v: number },
  b: { u: number; v: number },
): boolean {
  const eps = 1e-8;
  if (Math.abs(orient2d(a, b, p)) > eps) return false;
  return (
    p.u >= Math.min(a.u, b.u) - eps &&
    p.u <= Math.max(a.u, b.u) + eps &&
    p.v >= Math.min(a.v, b.v) - eps &&
    p.v <= Math.max(a.v, b.v) + eps
  );
}

function segmentsIntersect2d(
  a: { u: number; v: number },
  b: { u: number; v: number },
  c: { u: number; v: number },
  d: { u: number; v: number },
): boolean {
  const o1 = orient2d(a, b, c);
  const o2 = orient2d(a, b, d);
  const o3 = orient2d(c, d, a);
  const o4 = orient2d(c, d, b);
  if ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true;
  return pointOnSegment2d(c, a, b) || pointOnSegment2d(d, a, b) || pointOnSegment2d(a, c, d) || pointOnSegment2d(b, c, d);
}

function distancePointToSegment2d(
  p: { u: number; v: number },
  a: { u: number; v: number },
  b: { u: number; v: number },
): number {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const denom = du * du + dv * dv;
  const t = denom < 1e-18 ? 0 : ((p.u - a.u) * du + (p.v - a.v) * dv) / denom;
  const tc = Math.max(0, Math.min(1, t));
  return Math.hypot(p.u - (a.u + du * tc), p.v - (a.v + dv * tc));
}

function polygonsOverlap2d(
  a: readonly { u: number; v: number }[],
  b: readonly { u: number; v: number }[],
): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const p of a) if (pointInPolygon2d(p.u, p.v, b)) return true;
  for (const p of b) if (pointInPolygon2d(p.u, p.v, a)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect2d(a1, a2, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

function polygonDistance2d(
  a: readonly { u: number; v: number }[],
  b: readonly { u: number; v: number }[],
): number {
  if (polygonsOverlap2d(a, b)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (const p of b) best = Math.min(best, distancePointToSegment2d(p, a1, a2));
  }
  for (let i = 0; i < b.length; i++) {
    const b1 = b[i]!;
    const b2 = b[(i + 1) % b.length]!;
    for (const p of a) best = Math.min(best, distancePointToSegment2d(p, b1, b2));
  }
  return best;
}

function panelCornersToAabb(corners: readonly WorldPosition3D[]): AxisAlignedBounds3D {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function isNearRidgeOrHip(s: PvPanelStructuralSemantic): boolean {
  return s === "ridge" || s === "hip";
}

function isNearRoofBreak(s: PvPanelStructuralSemantic): boolean {
  return s === "flash" || s === "internal_split" || s === "break_line";
}

function isSharedStructural(
  s: PvPanelStructuralSemantic,
  incidentCount: number
): boolean {
  return s === "shared_inter_pan" || incidentCount >= 2;
}

export interface PanelContextBuildOptions {
  readonly patch: RoofPlanePatch3D;
  readonly basis: PatchTangentBasis;
  readonly panelCornersWorld: readonly [WorldPosition3D, WorldPosition3D, WorldPosition3D, WorldPosition3D];
  readonly centerWorld: WorldPosition3D;
  readonly structuralLineSegments?: readonly StructuralLineSegment3D[];
  readonly obstacleVolumes?: readonly RoofObstacleVolume3D[];
  readonly extensionVolumes?: readonly RoofExtensionVolume3D[];
}

export function computePvPanelSpatialContext(opts: PanelContextBuildOptions): PvPanelSpatialContext3D {
  const { patch, basis, panelCornersWorld, centerWorld } = opts;

  const origin = basis.origin;
  const patchBoundaryUv: { u: number; v: number }[] = [];
  for (const p of patch.cornersWorld) {
    patchBoundaryUv.push(worldToPlaneUv(p, origin, basis.uHat, basis.vHat));
  }

  const panelQuadUv = panelCornersWorld.map((p) => worldToPlaneUv(p, origin, basis.uHat, basis.vHat));

  const sampleUvs: { u: number; v: number }[] = [...panelQuadUv];
  sampleUvs.push(worldToPlaneUv(centerWorld, origin, basis.uHat, basis.vHat));

  let patchBoundary: PvPanelPatchBoundaryContext3D;
  if (patchBoundaryUv.length < 3) {
    patchBoundary = {
      patchBoundaryPolygonUv: [],
      panelQuadUv: [],
      centerInsidePatchBoundary: false,
      cornersAllInsidePatchBoundary: false,
      minDistanceToPatchBoundaryM: null,
      maxCornerMinDistanceToPatchBoundaryM: null,
      nearestPatchBoundaryEdgeIndex: null,
      nearestPatchBoundaryEdgeId: null,
      edgeClearanceClass: "unknown",
      nearRoofBoundary: false,
    };
  } else {
    const centerUv = sampleUvs[sampleUvs.length - 1];
    const centerInside = pointInPolygon2d(centerUv.u, centerUv.v, patchBoundaryUv);
    let cornersAllInside = true;
    for (const c of panelQuadUv) {
      if (!pointInPolygon2d(c.u, c.v, patchBoundaryUv)) {
        cornersAllInside = false;
        break;
      }
    }

    const metrics = computePanelToPatchBoundaryMetrics2d(panelQuadUv, sampleUvs, patchBoundaryUv);

    const minD = metrics?.minDistanceM ?? null;
    const maxCornerMin = metrics?.maxCornerMinDistanceM ?? null;
    const nearestIdx = metrics?.nearestEdgeIndex ?? null;
    const nearestEdgeId =
      nearestIdx != null && patch.boundaryEdgeIds.length === patchBoundaryUv.length
        ? patch.boundaryEdgeIds[nearestIdx % patch.boundaryEdgeIds.length]!
        : null;

    const edgeClass = clearanceClass(minD);
    const nearBoundary = minD != null && minD < TIGHT_M;

    patchBoundary = {
      patchBoundaryPolygonUv: patchBoundaryUv,
      panelQuadUv,
      centerInsidePatchBoundary: centerInside,
      cornersAllInsidePatchBoundary: cornersAllInside,
      minDistanceToPatchBoundaryM: minD,
      maxCornerMinDistanceToPatchBoundaryM: maxCornerMin,
      nearestPatchBoundaryEdgeIndex: nearestIdx,
      nearestPatchBoundaryEdgeId: nearestEdgeId,
      edgeClearanceClass: edgeClass,
      nearRoofBoundary: nearBoundary,
    };
  }

  const structuralLines = computeStructuralProximity(
    opts.structuralLineSegments,
    patch.id,
    panelCornersWorld,
    centerWorld
  );

  const volumes = computeVolumeProximity(
    opts.obstacleVolumes,
    opts.extensionVolumes,
    panelCornersWorld,
    patch,
    basis,
  );

  const hadStructural = opts.structuralLineSegments !== undefined;
  const hadObstacles = opts.obstacleVolumes !== undefined;
  const hadExtensions = opts.extensionVolumes !== undefined;

  let spatialContextQuality: PvPanelSpatialContextQuality;
  if (patchBoundaryPatchFailed(patchBoundary)) {
    spatialContextQuality = "missing";
  } else if (hadStructural && hadObstacles && hadExtensions) {
    spatialContextQuality = "complete";
  } else {
    spatialContextQuality = "partial";
  }

  const geometricAnchorQuality = computeGeometricAnchorQuality(
    patchBoundary,
    structuralLines,
    volumes
  );

  return {
    patchBoundary,
    structuralLines,
    volumes,
    spatialContextQuality,
    geometricAnchorQuality,
  };
}

function patchBoundaryPatchFailed(b: PvPanelPatchBoundaryContext3D): boolean {
  return b.patchBoundaryPolygonUv.length < 3;
}

function computeStructuralProximity(
  segments: readonly StructuralLineSegment3D[] | undefined,
  patchId: string,
  panelCorners: readonly WorldPosition3D[],
  center: WorldPosition3D
): PvPanelStructuralProximity3D {
  if (segments === undefined) {
    return {
      nearestStructuralLineId: null,
      nearestStructuralSemantic: "unknown",
      minDistanceToStructuralLineM: null,
      structuralSegmentsEvaluated: 0,
      nearRidgeOrHip: false,
      nearRoofBreak: false,
      nearSharedStructuralEdge: false,
    };
  }

  if (segments.length === 0) {
    return {
      nearestStructuralLineId: null,
      nearestStructuralSemantic: "unknown",
      minDistanceToStructuralLineM: Infinity,
      structuralSegmentsEvaluated: 0,
      nearRidgeOrHip: false,
      nearRoofBreak: false,
      nearSharedStructuralEdge: false,
    };
  }

  const samples = [...panelCorners, center];
  let bestId: string | null = null;
  let bestD = Infinity;
  let bestSemantic: PvPanelStructuralSemantic = "unknown";
  let bestIncidentCount = 0;

  for (const seg of segments) {
    if (!seg.incidentPlanePatchIds.includes(patchId)) continue;
    for (const p of samples) {
      const d = distancePointToSegment3D(p, seg.endpointAWorld, seg.endpointBWorld);
      if (d < bestD) {
        bestD = d;
        bestId = seg.id;
        bestSemantic = seg.semanticKind as PvPanelStructuralSemantic;
        bestIncidentCount = seg.incidentPlanePatchIds.length;
      }
    }
  }

  const evaluated = segments.filter((s) => s.incidentPlanePatchIds.includes(patchId)).length;

  const nearRidge = bestId != null && isNearRidgeOrHip(bestSemantic) && bestD < TIGHT_M;
  const nearBreak = bestId != null && isNearRoofBreak(bestSemantic) && bestD < TIGHT_M;
  const nearShared =
    bestId != null && isSharedStructural(bestSemantic, bestIncidentCount) && bestD < TIGHT_M;

  return {
    nearestStructuralLineId: bestId,
    nearestStructuralSemantic: bestSemantic,
    minDistanceToStructuralLineM: bestId == null ? Infinity : bestD,
    structuralSegmentsEvaluated: evaluated,
    nearRidgeOrHip: nearRidge,
    nearRoofBreak: nearBreak,
    nearSharedStructuralEdge: nearShared,
  };
}

function computeVolumeProximity(
  obstacles: readonly RoofObstacleVolume3D[] | undefined,
  extensions: readonly RoofExtensionVolume3D[] | undefined,
  panelCorners: readonly WorldPosition3D[],
  patch: RoofPlanePatch3D,
  basis: PatchTangentBasis,
): PvPanelVolumeProximityContext3D {
  const panelAabb = panelCornersToAabb(panelCorners);
  const panelQuadUv = panelCorners.map((p) => worldToPlaneUv(p, basis.origin, basis.uHat, basis.vHat));

  let bestObsId: string | null = null;
  let bestObsD = Infinity;
  if (obstacles) {
    for (const v of obstacles) {
      const d = distanceAabbToAabb(panelAabb, v.bounds);
      if (d < bestObsD) {
        bestObsD = d;
        bestObsId = v.id;
      }
    }
  }

  let bestExtId: string | null = null;
  let bestExtD = Infinity;
  let extensionFootprintOverlap = false;
  if (extensions) {
    for (const v of extensions) {
      const sameSupport =
        v.relatedPlanePatchIds.length === 0 ||
        v.relatedPlanePatchIds.map(String).includes(String(patch.id));
      const footprintUv = sameSupport && v.footprintWorld.length >= 3
        ? v.footprintWorld.map((p) => worldToPlaneUv(p, basis.origin, basis.uHat, basis.vHat))
        : [];
      const d = footprintUv.length >= 3
        ? polygonDistance2d(panelQuadUv, footprintUv)
        : distanceAabbToAabb(panelAabb, v.bounds);
      if (d < bestExtD) {
        bestExtD = d;
        bestExtId = v.id;
      }
      if (footprintUv.length >= 3 && polygonsOverlap2d(panelQuadUv, footprintUv)) {
        extensionFootprintOverlap = true;
      }
    }
  }

  let bestOverlap: PvPanelVolumeOverlapLikelihood = "unknown";
  let conflict = false;

  if (obstacles !== undefined || extensions !== undefined) {
    const vols = [...(obstacles ?? []), ...(extensions ?? [])];
    if (vols.length === 0) {
      bestOverlap = "none";
    } else {
      let anyOverlap = extensionFootprintOverlap;
      let minSep = Infinity;
      for (const v of obstacles ?? []) {
        const d = distanceAabbToAabb(panelAabb, v.bounds);
        if (d < minSep) minSep = d;
        if (aabbOverlap(panelAabb, v.bounds)) {
          anyOverlap = true;
          conflict = true;
        }
      }
      if (bestExtD < minSep) minSep = bestExtD;
      if (extensionFootprintOverlap) conflict = true;
      if (anyOverlap) bestOverlap = "moderate";
      else if (minSep < 0.1) bestOverlap = "low";
      else bestOverlap = "none";
    }
  }

  return {
    nearestObstacleVolumeId: bestObsId,
    nearestObstacleDistanceM:
      obstacles === undefined ? null : bestObsId == null ? null : bestObsD,
    nearestExtensionVolumeId: bestExtId,
    nearestExtensionDistanceM:
      extensions === undefined ? null : bestExtId == null ? null : bestExtD,
    overlapLikelihood: bestOverlap,
    footprintConflictHint: conflict,
  };
}

function computeGeometricAnchorQuality(
  patch: PvPanelPatchBoundaryContext3D,
  structural: PvPanelStructuralProximity3D,
  volumes: PvPanelVolumeProximityContext3D
): PvPanelGeometricAnchorQuality {
  const minD = patch.minDistanceToPatchBoundaryM;
  if (minD == null) return "unknown";

  if (
    !patch.cornersAllInsidePatchBoundary ||
    minD < CRITICAL_M ||
    volumes.footprintConflictHint
  ) {
    return "weak";
  }
  if (minD < MODERATE_M || patch.nearRoofBoundary || structural.nearRoofBreak || structural.nearSharedStructuralEdge) {
    return "moderate";
  }
  return "strong";
}
