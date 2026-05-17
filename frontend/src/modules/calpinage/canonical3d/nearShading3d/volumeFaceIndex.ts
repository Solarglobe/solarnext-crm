/**
 * Accelerateur BVH niveau 2 -- index AABB par face de volume.
 *
 * Pipeline de complexite reduite (par rayon par volume) :
 *   Avant : O(faces x triangles_par_face)
 *   Apres : O(faces) tests AABB  +  O(faces_touchees x triangles)
 *
 * Construction : UNE FOIS par objet volume (WeakMap).
 * Invalidation : automatique -- quand les obstacles changent, la scene 3D est
 * reconstruite avec de nouveaux objets volumes ; les anciennes entrees WeakMap
 * sont ramassees par le GC sans aucun code manuel.
 *
 * Aucune dependance externe -- module pure TypeScript.
 */

import type { Vector3 } from "../types/primitives";
import type { AxisAlignedBounds3D, VolumeFace3D } from "../types/volumetric-mesh";
import { rayAabbIntersects } from "./rayAabb";

// -- Types ------------------------------------------------------------------

export interface FaceAabbEntry {
  readonly face: VolumeFace3D;
  /** AABB englobante de tous les sommets de cette face (+ epsilon numerique). */
  readonly bounds: AxisAlignedBounds3D;
}

/** Index plat (pas d'arbre -- suffisant pour des volumes a <= ~200 faces). */
export interface VolumeFaceIndex {
  readonly entries: readonly FaceAabbEntry[];
}

/** Shape minimale requise pour construire l'index (obstacle ou extension). */
type VolumeWithVerticesAndFaces = {
  readonly faces: readonly VolumeFace3D[];
  readonly vertices: readonly { readonly position: Vector3 }[];
};

// -- Cache WeakMap ----------------------------------------------------------

/**
 * Cle = reference d'objet volume (stable dans une session, recree si obstacles changent).
 * WeakMap -> pas de fuite memoire.
 */
const _cache = new WeakMap<object, VolumeFaceIndex>();

// -- Helpers prives ---------------------------------------------------------

/**
 * AABB des sommets references par face.vertexIndexCycle.
 * Epsilon de 1e-5 m pour absorber les erreurs de virgule flottante sur les
 * faces coplanaires (evite des faux negatifs sur un rayon rasant).
 */
function buildFaceAabb(face: VolumeFace3D, positions: readonly Vector3[]): AxisAlignedBounds3D {
  const EPS = 1e-5;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const idx of face.vertexIndexCycle) {
    const p = positions[idx];
    if (p == null) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    min: { x: minX - EPS, y: minY - EPS, z: minZ - EPS },
    max: { x: maxX + EPS, y: maxY + EPS, z: maxZ + EPS },
  };
}

// -- API publique -----------------------------------------------------------

/**
 * Retourne l'index AABB des faces du volume, construit une seule fois et mis en cache.
 *
 * Appelable a chaque raycast : le test WeakMap est O(1) et la construction est
 * O(faces x sommets_par_face).
 */
export function getOrBuildVolumeFaceIndex(vol: VolumeWithVerticesAndFaces): VolumeFaceIndex {
  const cached = _cache.get(vol as object);
  if (cached) return cached;

  const positions: Vector3[] = vol.vertices.map((v) => v.position);
  const entries: FaceAabbEntry[] = vol.faces.map((face) => ({
    face,
    bounds: buildFaceAabb(face, positions),
  }));

  const index: VolumeFaceIndex = { entries };
  _cache.set(vol as object, index);
  return index;
}

/**
 * Filtre les faces dont l'AABB intersecte le rayon [origin + t*dirUnit, t in [tMin, tMax]].
 *
 * Les faces retournees sont les seules candidates pour le test triangle Moller-Trumbore.
 * Les faces dont l'AABB ne coupe pas le rayon sont eliminees sans aucun calcul triangle.
 */
export function filterFacesByRayAabb(
  index: VolumeFaceIndex,
  origin: Vector3,
  dirUnit: Vector3,
  tMin: number,
  tMax: number,
): readonly VolumeFace3D[] {
  const result: VolumeFace3D[] = [];
  for (const entry of index.entries) {
    if (rayAabbIntersects(origin, dirUnit, entry.bounds, tMin, tMax)) {
      result.push(entry.face);
    }
  }
  return result;
}
