/**
 * Raycast contre maillages volumiques canoniques (triangles) avec préfiltrage AABB.
 */

import type { NearShadingOccluderKind } from "../types/near-shading-3d";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { Vector3 } from "../types/primitives";
import type { AxisAlignedBounds3D, VolumeFace3D } from "../types/volumetric-mesh";
import { rayAabbIntersects } from "./rayAabb";
import { rayTriangleIntersectMollerTrumbore } from "./rayTriangle";
import { fanTriangulateVertexIndexCycle, trianglePositionsFromIndices } from "./triangulateFace";

interface VolumeMeshLike {
  readonly faces: readonly VolumeFace3D[];
  readonly bounds: AxisAlignedBounds3D;
}

export interface VolumeRaycastHit {
  readonly t: number;
  readonly volumeId: string;
  readonly faceId: string;
  readonly kind: NearShadingOccluderKind;
}

function positionsFromVolumeVertices(v: { readonly vertices: readonly { readonly position: Vector3 }[] }): Vector3[] {
  return v.vertices.map((x) => x.position);
}

function raycastSingleVolume(
  origin: Vector3,
  dirUnit: Vector3,
  tMinRay: number,
  tMaxRay: number,
  volumeId: string,
  kind: NearShadingOccluderKind,
  positions: readonly Vector3[],
  volume: VolumeMeshLike,
  useAabb: boolean
): VolumeRaycastHit | null {
  if (useAabb && !rayAabbIntersects(origin, dirUnit, volume.bounds, tMinRay, tMaxRay)) {
    return null;
  }
  let bestT = Infinity;
  let bestFaceId: string | null = null;
  for (const face of volume.faces) {
    const tris = fanTriangulateVertexIndexCycle(face.vertexIndexCycle);
    for (const [ia, ib, ic] of tris) {
      const tri = trianglePositionsFromIndices(positions as Vector3[], ia, ib, ic);
      if (!tri) continue;
      const t = rayTriangleIntersectMollerTrumbore(origin, dirUnit, tri.a, tri.b, tri.c, tMinRay);
      if (t != null && t < bestT && t <= tMaxRay) {
        bestT = t;
        bestFaceId = face.id;
      }
    }
  }
  if (bestFaceId == null || !Number.isFinite(bestT)) return null;
  return { t: bestT, volumeId, faceId: bestFaceId, kind };
}

/**
 * Premier hit bloquant le long du rayon (plus petit t), parmi obstacles et extensions.
 */
export function findClosestOccluderHit(
  origin: Vector3,
  dirUnit: Vector3,
  tMinRay: number,
  tMaxRay: number,
  obstacles: readonly RoofObstacleVolume3D[],
  extensions: readonly RoofExtensionVolume3D[],
  useAabb: boolean
): VolumeRaycastHit | null {
  let best: VolumeRaycastHit | null = null;
  for (const vol of obstacles) {
    const pos = positionsFromVolumeVertices(vol);
    const hit = raycastSingleVolume(origin, dirUnit, tMinRay, tMaxRay, vol.id, "obstacle", pos, vol, useAabb);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  for (const vol of extensions) {
    const pos = positionsFromVolumeVertices(vol);
    const hit = raycastSingleVolume(origin, dirUnit, tMinRay, tMaxRay, vol.id, "extension", pos, vol, useAabb);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

