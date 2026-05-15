import type { WorldPosition3D } from "../types/coordinates";
import type { Vector3 } from "../types/primitives";
import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "../types/volumetric-mesh";
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from "../utils/math3";
import type { ProjectedRoofExtensionGeometry } from "./projectRoofExtensionToSupportPlane";
import type { RoofExtensionSource2D } from "./roofExtensionSource";

const AREA_EPS_M2 = 1e-8;
const LENGTH_EPS_M = 1e-7;
const RIDGE_T_EPS = 1e-6;

function nearlySameWorld(a: Vector3, b: Vector3, eps = 5e-5): boolean {
  return length3(sub3(a, b)) < eps;
}

export interface DormerTopologyMesh {
  readonly vertices: readonly VolumeVertex3D[];
  readonly edges: readonly VolumeEdge3D[];
  readonly faces: readonly VolumeFace3D[];
  readonly bounds: AxisAlignedBounds3D;
  readonly centroid: WorldPosition3D;
  readonly surfaceAreaM2: number;
  readonly volumeM3: number;
}

function centroidPoints(points: readonly Vector3[]): WorldPosition3D {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const k = Math.max(1, points.length);
  return { x: x / k, y: y / k, z: z / k };
}

function boundsOf(points: readonly Vector3[]): AxisAlignedBounds3D {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
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

function interpolate3(a: Vector3, b: Vector3, t: number): Vector3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function projectionParamOnRidge(base: Vector3, ridgeA: Vector3, ridgeB: Vector3): number {
  const ab = sub3(ridgeB, ridgeA);
  const len2 = dot3(ab, ab);
  if (len2 < LENGTH_EPS_M * LENGTH_EPS_M) return 0;
  return clamp01(dot3(sub3(base, ridgeA), ab) / len2);
}

function faceCenter(cycle: readonly number[], positions: readonly Vector3[]): Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of cycle) {
    const p = positions[index]!;
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const k = Math.max(1, cycle.length);
  return { x: x / k, y: y / k, z: z / k };
}

function faceAreaNormal(
  cycle: readonly number[],
  positions: readonly Vector3[],
): { areaM2: number; normal: Vector3 | null } {
  if (cycle.length < 3) return { areaM2: 0, normal: null };
  const origin = positions[cycle[0]!]!;
  let areaM2 = 0;
  let weighted = { x: 0, y: 0, z: 0 };
  for (let i = 1; i < cycle.length - 1; i++) {
    const b = positions[cycle[i]!]!;
    const c = positions[cycle[i + 1]!]!;
    const triCross = cross3(sub3(b, origin), sub3(c, origin));
    const triArea = length3(triCross) * 0.5;
    areaM2 += triArea;
    weighted = add3(weighted, triCross);
  }
  return { areaM2, normal: normalize3(weighted) };
}

function orientedFace(
  id: string,
  kind: VolumeFace3D["kind"],
  rawCycle: readonly number[],
  positions: readonly Vector3[],
  solidCentroid: Vector3,
): VolumeFace3D | null {
  const cycle = rawCycle.filter((index, i) => i === 0 || index !== rawCycle[i - 1]);
  if (cycle.length >= 2 && cycle[0] === cycle[cycle.length - 1]) cycle.pop();
  if (cycle.length < 3) return null;
  let { areaM2, normal } = faceAreaNormal(cycle, positions);
  if (!normal || areaM2 <= AREA_EPS_M2) return null;
  const center = faceCenter(cycle, positions);
  if (dot3(normal, sub3(center, solidCentroid)) < 0) {
    cycle.reverse();
    const flipped = faceAreaNormal(cycle, positions);
    areaM2 = flipped.areaM2;
    normal = flipped.normal ? flipped.normal : scale3(normal, -1);
  }
  return {
    id,
    kind,
    vertexIndexCycle: cycle,
    outwardUnitNormal: normal,
    areaM2,
  };
}

function computeVolumeM3(positions: readonly Vector3[], faces: readonly VolumeFace3D[]): number {
  let sum = 0;
  for (const face of faces) {
    const cycle = face.vertexIndexCycle;
    if (cycle.length < 3) continue;
    const a = positions[cycle[0]!]!;
    for (let i = 1; i < cycle.length - 1; i++) {
      const b = positions[cycle[i]!]!;
      const c = positions[cycle[i + 1]!]!;
      sum += dot3(a, cross3(b, c)) / 6;
    }
  }
  return Math.abs(sum);
}

export function buildDormerTopologyFromOutline(
  source: RoofExtensionSource2D,
  projected: ProjectedRoofExtensionGeometry,
): DormerTopologyMesh | null {
  const n = projected.contour.length;
  if (n < 3) return null;

  const vertices: VolumeVertex3D[] = [];
  const addVertex = (id: string, position: Vector3): number => {
    const index = vertices.length;
    vertices.push({ id, position: { x: position.x, y: position.y, z: position.z } });
    return index;
  };

  const baseIndexes = projected.contour.map((point, index) =>
    addVertex(`${source.id}:base:${index}`, point.base),
  );
  const topIndexes = projected.contour.map((point, index) =>
    addVertex(`${source.id}:outline:${index}`, point.top),
  );
  const apx = projected.apex;
  const apexId = projected.apexTopVertexId;
  let sharedApexTopIndex: number | null = null;
  if (apx && apexId) {
    sharedApexTopIndex = addVertex(`${source.id}:${apexId}`, apx.top);
  }

  const ridgeAIndex =
    sharedApexTopIndex != null && apx != null && nearlySameWorld(projected.ridge.a.top, apx.top)
      ? sharedApexTopIndex
      : addVertex(`${source.id}:ridge:a`, projected.ridge.a.top);
  const ridgeBIndex =
    sharedApexTopIndex != null && apx != null && nearlySameWorld(projected.ridge.b.top, apx.top)
      ? sharedApexTopIndex
      : addVertex(`${source.id}:ridge:b`, projected.ridge.b.top);
  const ridgeSampleByKey = new Map<string, number>([
    ["0", ridgeAIndex],
    ["1", ridgeBIndex],
  ]);

  const ridgeBaseA = projected.ridge.a.base;
  const ridgeBaseB = projected.ridge.b.base;
  const ridgeHeightA = projected.ridge.a.heightRelM;
  const ridgeHeightB = projected.ridge.b.heightRelM;

  const ridgeIndexAt = (tRaw: number): number => {
    const t = clamp01(tRaw);
    if (t <= RIDGE_T_EPS) return ridgeAIndex;
    if (t >= 1 - RIDGE_T_EPS) return ridgeBIndex;
    const key = t.toFixed(6);
    const existing = ridgeSampleByKey.get(key);
    if (existing != null) return existing;
    const base = interpolate3(ridgeBaseA, ridgeBaseB, t);
    const h = ridgeHeightA + (ridgeHeightB - ridgeHeightA) * t;
    const top = add3(base, scale3(projected.supportNormal, h));
    if (sharedApexTopIndex != null && apx != null && nearlySameWorld(top, apx.top)) {
      ridgeSampleByKey.set(key, sharedApexTopIndex);
      return sharedApexTopIndex;
    }
    const idx = addVertex(`${source.id}:ridge:sample:${key}`, top);
    ridgeSampleByKey.set(key, idx);
    return idx;
  };

  if (sharedApexTopIndex != null && apx != null) {
    const tApex = projectionParamOnRidge(apx.base, ridgeBaseA, ridgeBaseB);
    if (tApex > RIDGE_T_EPS && tApex < 1 - RIDGE_T_EPS) {
      ridgeSampleByKey.set(tApex.toFixed(6), sharedApexTopIndex);
    }
  }

  const ridgeIndexesForContour = projected.contour.map((point) =>
    ridgeIndexAt(projectionParamOnRidge(point.base, ridgeBaseA, ridgeBaseB)),
  );

  const edges: VolumeEdge3D[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (id: string, a: number, b: number, kind: VolumeEdge3D["kind"]): void => {
    if (a === b) return;
    const pa = vertices[a]!.position;
    const pb = vertices[b]!.position;
    if (length3(sub3(pa, pb)) < LENGTH_EPS_M) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id, vertexAIndex: a, vertexBIndex: b, kind });
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    addEdge(`${source.id}:edge:base:${i}`, baseIndexes[i]!, baseIndexes[j]!, "base");
    addEdge(`${source.id}:edge:outline:${i}`, topIndexes[i]!, topIndexes[j]!, "top");
    addEdge(`${source.id}:edge:lateral:${i}`, baseIndexes[i]!, topIndexes[i]!, "lateral");
    addEdge(`${source.id}:edge:roof:${i}:a`, topIndexes[i]!, ridgeIndexesForContour[i]!, "other");
  }
  addEdge(`${source.id}:edge:ridge`, ridgeAIndex, ridgeBIndex, "top");

  const positions = vertices.map((v) => v.position);
  const centroid = centroidPoints(positions);
  const faces: VolumeFace3D[] = [];
  const addFace = (id: string, kind: VolumeFace3D["kind"], cycle: readonly number[]): void => {
    const face = orientedFace(id, kind, cycle, positions, centroid);
    if (face) faces.push(face);
  };

  addFace(`${source.id}:face:base`, "base", [...baseIndexes].reverse());

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const hi = projected.contour[i]!.heightRelM;
    const hj = projected.contour[j]!.heightRelM;
    if (hi > LENGTH_EPS_M || hj > LENGTH_EPS_M) {
      addFace(`${source.id}:face:wall:${i}`, "side", [
        baseIndexes[i]!,
        baseIndexes[j]!,
        topIndexes[j]!,
        topIndexes[i]!,
      ]);
    }

    const ri = ridgeIndexesForContour[i]!;
    const rj = ridgeIndexesForContour[j]!;
    const roofCycle = ri === rj
      ? [topIndexes[i]!, topIndexes[j]!, ri]
      : [topIndexes[i]!, topIndexes[j]!, rj, ri];
    addFace(`${source.id}:face:roof:${i}`, "top", roofCycle);
  }

  if (faces.length === 0) return null;
  const surfaceAreaM2 = faces.reduce((sum, face) => sum + face.areaM2, 0);

  return {
    vertices,
    edges,
    faces,
    bounds: boundsOf(positions),
    centroid,
    surfaceAreaM2,
    volumeM3: computeVolumeM3(positions, faces),
  };
}
