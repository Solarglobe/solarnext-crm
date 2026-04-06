/**
 * Prisme droit : base polygonale coplanaire, extrusion parallèle à un vecteur unitaire u (ex. normale pan).
 */

import type { Vector3 } from "../types/primitives";
import type { WorldPosition3D } from "../types/coordinates";
import type { VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "../types/volumetric-mesh";
import { add3, cross3, dot3, length3, normalize3, scale3, sub3, vec3 } from "../utils/math3";
import { computeVolumeM3FromTriangleMesh } from "./meshVolume";

export interface GeneralPrismMeshResult {
  readonly vertices: readonly VolumeVertex3D[];
  readonly edges: readonly VolumeEdge3D[];
  readonly faces: readonly VolumeFace3D[];
  readonly centroid: WorldPosition3D;
  readonly volumeM3: number;
  readonly surfaceAreaM2: number;
  readonly bounds: { readonly min: WorldPosition3D; readonly max: WorldPosition3D };
}

function centroidPoints(pts: readonly Vector3[]): WorldPosition3D {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const k = pts.length;
  return { x: x / k, y: y / k, z: z / k };
}

function aabb(pts: readonly Vector3[]): { min: WorldPosition3D; max: WorldPosition3D } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
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

function faceNormalFromTriangle(a: Vector3, b: Vector3, c: Vector3, centroidSolid: Vector3): Vector3 {
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const n = cross3(ab, ac);
  const nu = normalize3(n);
  if (!nu) return vec3(0, 0, 1);
  const fc = centroidPoints([a, b, c]);
  const toSolid = sub3(centroidSolid, fc);
  if (dot3(nu, toSolid) < 0) {
    return { x: -nu.x, y: -nu.y, z: -nu.z };
  }
  return nu;
}

/** Base : normale sortante vers le solide ≈ -u ; haut : +u. */
function alignBaseNormal(nu: Vector3, u: Vector3): Vector3 {
  const target = scale3(u, -1);
  let n = nu;
  if (dot3(n, target) < 0) n = scale3(n, -1);
  return normalize3(n) ?? n;
}

function alignTopNormal(nu: Vector3, u: Vector3): Vector3 {
  let n = nu;
  if (dot3(n, u) < 0) n = scale3(n, -1);
  return normalize3(n) ?? n;
}

/**
 * Extrusion parallèle : top[i] = base[i] + u * heightM (u unitaire).
 */
export function extrudePrismAlongUnitDirection(
  baseCoplanar: readonly WorldPosition3D[],
  uUnit: Vector3,
  heightM: number,
  idPrefix: string
): GeneralPrismMeshResult {
  const n = baseCoplanar.length;
  const uu = normalize3(uUnit);
  if (n < 3 || !uu || !Number.isFinite(heightM) || heightM <= 0) {
    return {
      vertices: [],
      edges: [],
      faces: [],
      centroid: { x: 0, y: 0, z: 0 },
      volumeM3: 0,
      surfaceAreaM2: 0,
      bounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
    };
  }

  const offset = scale3(uu, heightM);
  const top: WorldPosition3D[] = baseCoplanar.map((p) => {
    const q = add3(p, offset);
    return { x: q.x, y: q.y, z: q.z };
  });

  const allPts: Vector3[] = [...baseCoplanar, ...top];
  const centroid = centroidPoints(allPts);
  const bounds = aabb(allPts);

  const vertices: VolumeVertex3D[] = allPts.map((p, i) => ({
    id: `${idPrefix}-v-${i}`,
    position: { ...p },
  }));

  const edges: VolumeEdge3D[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edges.push({
      id: `${idPrefix}-e-base-${i}`,
      vertexAIndex: i,
      vertexBIndex: j,
      kind: "base",
    });
    edges.push({
      id: `${idPrefix}-e-top-${i}`,
      vertexAIndex: i + n,
      vertexBIndex: j + n,
      kind: "top",
    });
    edges.push({
      id: `${idPrefix}-e-lat-${i}`,
      vertexAIndex: i,
      vertexBIndex: i + n,
      kind: "lateral",
    });
  }

  const faces: VolumeFace3D[] = [];

  for (let t = 1; t < n - 1; t++) {
    const i0 = 0;
    const i1 = t;
    const i2 = t + 1;
    const a = baseCoplanar[i0];
    const b = baseCoplanar[i1];
    const c = baseCoplanar[i2];
    let nu = faceNormalFromTriangle(a, b, c, centroid);
    nu = alignBaseNormal(nu, uu);
    const triArea = length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-base-tri-${t}`,
      kind: "base",
      vertexIndexCycle: [i0, i1, i2],
      outwardUnitNormal: nu,
      areaM2: triArea,
    });
  }

  for (let t = 1; t < n - 1; t++) {
    const i0 = n;
    const i1 = n + t;
    const i2 = n + t + 1;
    const a = top[0];
    const b = top[t];
    const c = top[t + 1];
    let nu = faceNormalFromTriangle(a, b, c, centroid);
    nu = alignTopNormal(nu, uu);
    const triArea = length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-top-tri-${t}`,
      kind: "top",
      vertexIndexCycle: [i0, i1, i2],
      outwardUnitNormal: nu,
      areaM2: triArea,
    });
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = baseCoplanar[i];
    const b = baseCoplanar[j];
    const c = top[j];
    const d = top[i];
    let nu1 = faceNormalFromTriangle(a, b, c, centroid);
    nu1 = normalize3(nu1) ?? nu1;
    const area1 = length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-side-a-${i}`,
      kind: "side",
      vertexIndexCycle: [i, j, j + n],
      outwardUnitNormal: nu1,
      areaM2: area1,
    });
    let nu2 = faceNormalFromTriangle(a, c, d, centroid);
    nu2 = normalize3(nu2) ?? nu2;
    const area2 = length3(cross3(sub3(c, a), sub3(d, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-side-b-${i}`,
      kind: "side",
      vertexIndexCycle: [i, j + n, i + n],
      outwardUnitNormal: nu2,
      areaM2: area2,
    });
  }

  let surfaceAreaM2 = 0;
  for (const f of faces) surfaceAreaM2 += f.areaM2;

  const pos = allPts;
  const volumeM3 = computeVolumeM3FromTriangleMesh(pos, faces);

  return {
    vertices,
    edges,
    faces,
    centroid,
    volumeM3,
    surfaceAreaM2,
    bounds,
  };
}
