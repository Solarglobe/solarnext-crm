/**
 * Raycast contre maillages volumiques canoniques (triangles) avec préfiltrage AABB.
 *
 * Accélération BVH deux niveaux :
 *   Niveau 0 -- AABB du volume entier       (broad phase, preexistant)
 *   Niveau 1 -- AABB par face               (NEW -- via volumeFaceIndex)
 *   Niveau 2 -- Moller-Trumbore par triangle (inchange)
 *
 * Interface publique (findClosestOccluderHit + VolumeRaycastHit) : identique.
 */

import type { NearShadingOccluderKind } from "../types/near-shading-3d";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { Vector3 } from "../types/primitives";
import type { AxisAlignedBounds3D, VolumeFace3D } from "../types/volumetric-mesh";
import { rayAabbIntersects } from "./rayAabb";
import { rayTriangleIntersectMollerTrumbore } from "./rayTriangle";
import { fanTriangulateVertexIndexCycle, trianglePositionsFromIndices } from "./triangulateFace";
import { filterFacesByRayAabb, getOrBuildVolumeFaceIndex } from "./volumeFaceIndex";

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

/**
 * Raycast contre un volume unique.
 *
 * candidateFaces -- faces pre-filtrees par AABB (peut etre volume.faces si pas de BVH).
 * Passer un sous-ensemble reduit est la principale source d'acceleration.
 */
function raycastSingleVolume(
  origin: Vector3,
  dirUnit: Vector3,
  tMinRay: number,
  tMaxRay: number,
  volumeId: string,
  kind: NearShadingOccluderKind,
  positions: readonly Vector3[],
  volume: VolumeMeshLike,
  useAabb: boolean,
  candidateFaces: readonly VolumeFace3D[],
): VolumeRaycastHit | null {
  if (useAabb && !rayAabbIntersects(origin, dirUnit, volume.bounds, tMinRay, tMaxRay)) {
    return null;
  }
  let bestT = Infinity;
  let bestFaceId: string | null = null;
  for (const face of candidateFaces) {
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
 *
 * Interface identique a la version sans BVH -- resultat identique, performance amelioree.
 *
 * BVH :
 * - getOrBuildVolumeFaceIndex construit l'index AABB/face une seule fois par objet volume
 *   (WeakMap -> invalidation automatique quand la scene est reconstruite).
 * - filterFacesByRayAabb elimine les faces dont l'AABB ne coupe pas le rayon
 *   avant tout test triangle.
 */
export function findClosestOccluderHit(
  origin: Vector3,
  dirUnit: Vector3,
  tMinRay: number,
  tMaxRay: number,
  obstacles: readonly RoofObstacleVolume3D[],
  extensions: readonly RoofExtensionVolume3D[],
  useAabb: boolean,
): VolumeRaycastHit | null {
  let best: VolumeRaycastHit | null = null;

  for (const vol of obstacles) {
    // Broad phase volume AABB -- elimine le volume entier rapidement
    if (useAabb && !rayAabbIntersects(origin, dirUnit, vol.bounds, tMinRay, tMaxRay)) continue;

    const pos = positionsFromVolumeVertices(vol);
    // BVH niveau 1 : filtrage AABB par face (construit une seule fois par vol)
    const faceIndex = getOrBuildVolumeFaceIndex(vol);
    const candidateFaces = filterFacesByRayAabb(faceIndex, origin, dirUnit, tMinRay, tMaxRay);
    if (candidateFaces.length === 0) continue;

    const hit = raycastSingleVolume(
      origin, dirUnit, tMinRay, tMaxRay,
      vol.id, "obstacle", pos, vol,
      false, // AABB volume deja teste ci-dessus
      candidateFaces,
    );
    if (hit && (!best || hit.t < best.t)) best = hit;
  }

  for (const vol of extensions) {
    if (useAabb && !rayAabbIntersects(origin, dirUnit, vol.bounds, tMinRay, tMaxRay)) continue;

    const pos = positionsFromVolumeVertices(vol);
    const faceIndex = getOrBuildVolumeFaceIndex(vol);
    const candidateFaces = filterFacesByRayAabb(faceIndex, origin, dirUnit, tMinRay, tMaxRay);
    if (candidateFaces.length === 0) continue;

    const hit = raycastSingleVolume(
      origin, dirUnit, tMinRay, tMaxRay,
      vol.id, "extension", pos, vol,
      false,
      candidateFaces,
    );
    if (hit && (!best || hit.t < best.t)) best = hit;
  }

  return best;
}
