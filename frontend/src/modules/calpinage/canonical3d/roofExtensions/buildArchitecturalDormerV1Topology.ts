import type { WorldPosition3D } from "../types/coordinates";
import type { Vector3 } from "../types/primitives";
import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "../types/volumetric-mesh";
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from "../utils/math3";
import type { ProjectedRoofExtensionGeometry } from "./projectRoofExtensionToSupportPlane";
import type { DormerTopologyMesh } from "./buildDormerTopologyFromOutline";
import type { RoofExtensionV1 } from "./roofExtensionV1";

const AREA_EPS_M2 = 1e-8;
const LENGTH_EPS_M = 1e-7;

function finiteVector(p: Vector3): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
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
    areaM2 += length3(triCross) * 0.5;
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

function nearlySameWorld(a: Vector3, b: Vector3, eps = 5e-5): boolean {
  return length3(sub3(a, b)) < eps;
}

function unitOrNull(v: Vector3): Vector3 | null {
  const n = normalize3(v);
  return n && finiteVector(n) ? n : null;
}

export function buildArchitecturalDormerV1Topology(
  model: RoofExtensionV1,
  projected: ProjectedRoofExtensionGeometry,
): DormerTopologyMesh | null {
  if (model.supportPanId.length === 0) return null;
  if (model.footprintPx.length < 3) return null;
  const supportNormal = unitOrNull(projected.supportNormal);
  if (!supportNormal) return null;

  const ridgeBaseA = projected.ridge.a.base;
  const ridgeBaseB = projected.ridge.b.base;
  const ridgeTopA = projected.ridge.a.top;
  const ridgeTopB = projected.ridge.b.top;
  const ridgeAxis = unitOrNull(sub3(ridgeBaseB, ridgeBaseA));
  if (!ridgeAxis) return null;

  const ridgeMid = scale3(add3(ridgeBaseA, ridgeBaseB), 0.5);
  let depthAxis = unitOrNull(cross3(supportNormal, ridgeAxis));
  if (!depthAxis) return null;
  const footprintCentroid = centroidPoints(projected.contour.map((p) => p.base));
  if (dot3(sub3(footprintCentroid, ridgeMid), depthAxis) < 0) {
    depthAxis = scale3(depthAxis, -1);
  }

  const samples = projected.contour.map((p) => ({
    u: dot3(sub3(p.base, ridgeMid), ridgeAxis),
    v: dot3(sub3(p.base, ridgeMid), depthAxis),
  }));
  samples.push(
    { u: dot3(sub3(ridgeBaseA, ridgeMid), ridgeAxis), v: dot3(sub3(ridgeBaseA, ridgeMid), depthAxis) },
    { u: dot3(sub3(ridgeBaseB, ridgeMid), ridgeAxis), v: dot3(sub3(ridgeBaseB, ridgeMid), depthAxis) },
  );

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const s of samples) {
    uMin = Math.min(uMin, s.u);
    uMax = Math.max(uMax, s.u);
    vMin = Math.min(vMin, s.v);
    vMax = Math.max(vMax, s.v);
  }
  if (![uMin, uMax, vMin, vMax].every(Number.isFinite)) return null;
  if (uMax - uMin < LENGTH_EPS_M || vMax - vMin < LENGTH_EPS_M) return null;

  const wallHeightM = Math.max(0, model.dimensions.wallHeightM);

  const vertices: VolumeVertex3D[] = [];
  const addVertex = (id: string, position: Vector3): number => {
    if (!finiteVector(position)) return -1;
    const index = vertices.length;
    vertices.push({ id, position: { x: position.x, y: position.y, z: position.z } });
    return index;
  };

  // ─── Vrais coins du contour dessiné — pas la bounding box ───────────────────
  // Classe chaque point projeté en (u, v) dans le repère ridge :
  //   v élevé = "avant" (façade, loin du ridge) ; v faible = "arrière" (près du ridge)
  //   u faible = "gauche" ; u élevé = "droite"
  const contourUV = projected.contour.map((p) => ({
    base: p.base,
    u: dot3(sub3(p.base, ridgeMid), ridgeAxis),
    v: dot3(sub3(p.base, ridgeMid), depthAxis),
  }));
  const byV = [...contourUV].sort((a, b) => b.v - a.v);
  const half = Math.ceil(byV.length / 2);
  const frontG = byV.slice(0, half).sort((a, b) => a.u - b.u); // gauche→droite
  const rearG  = byV.slice(half).sort((a, b) => a.u - b.u);

  const flBase = frontG[0]!.base;
  const frBase = frontG[frontG.length - 1]!.base;
  const rlBase = (rearG[0] ?? frontG[0]!).base;
  const rrBase = (rearG[rearG.length - 1] ?? frontG[frontG.length - 1]!).base;

  const bFL = addVertex(`${model.id}:base:front-left`,  flBase);
  const bFR = addVertex(`${model.id}:base:front-right`, frBase);
  const bRR = addVertex(`${model.id}:base:rear-right`,  rrBase);
  const bRL = addVertex(`${model.id}:base:rear-left`,   rlBase);
  const eFL = addVertex(`${model.id}:eave:front-left`,  add3(flBase, scale3(supportNormal, wallHeightM)));
  const eFR = addVertex(`${model.id}:eave:front-right`, add3(frBase, scale3(supportNormal, wallHeightM)));
  const eRR = addVertex(`${model.id}:eave:rear-right`,  add3(rrBase, scale3(supportNormal, wallHeightM)));
  const eRL = addVertex(`${model.id}:eave:rear-left`,   add3(rlBase, scale3(supportNormal, wallHeightM)));

  const apexOnRidgeA = !!(projected.apex && model.apexId && nearlySameWorld(projected.apex.top, ridgeTopA));
  const apexOnRidgeB = !!(projected.apex && model.apexId && nearlySameWorld(projected.apex.top, ridgeTopB));
  const ridgeAIndex = addVertex(apexOnRidgeA ? `${model.id}:${model.apexId}` : `${model.id}:ridge:a`, ridgeTopA);
  const ridgeBIndex = nearlySameWorld(ridgeTopA, ridgeTopB)
    ? ridgeAIndex
    : addVertex(apexOnRidgeB ? `${model.id}:${model.apexId}` : `${model.id}:ridge:b`, ridgeTopB);
  let apexIndex: number | null = null;
  if (projected.apex && model.apexId) {
    if (apexOnRidgeA) {
      apexIndex = ridgeAIndex;
    } else if (apexOnRidgeB) {
      apexIndex = ridgeBIndex;
    } else {
      apexIndex = addVertex(`${model.id}:${model.apexId}`, projected.apex.top);
    }
  }
  if (
    vertices.length < 9 ||
    [bFL, bFR, bRR, bRL, eFL, eFR, eRR, eRL, ridgeAIndex, ridgeBIndex].some((x) => x < 0) ||
    apexIndex === -1
  ) {
    return null;
  }

  const ridgeUA = dot3(sub3(ridgeBaseA, ridgeMid), ridgeAxis);
  const ridgeUB = dot3(sub3(ridgeBaseB, ridgeMid), ridgeAxis);
  const ridgeLeftIndex = ridgeUA <= ridgeUB ? ridgeAIndex : ridgeBIndex;
  const ridgeRightIndex = ridgeUA <= ridgeUB ? ridgeBIndex : ridgeAIndex;

  const edges: VolumeEdge3D[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (id: string, a: number, b: number, kind: VolumeEdge3D["kind"]): void => {
    if (a === b || a < 0 || b < 0) return;
    const pa = vertices[a]!.position;
    const pb = vertices[b]!.position;
    if (length3(sub3(pa, pb)) < LENGTH_EPS_M) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id, vertexAIndex: a, vertexBIndex: b, kind });
  };

  addEdge(`${model.id}:edge:base:front`, bFL, bFR, "base");
  addEdge(`${model.id}:edge:base:right`, bFR, bRR, "base");
  addEdge(`${model.id}:edge:base:rear`, bRR, bRL, "base");
  addEdge(`${model.id}:edge:base:left`, bRL, bFL, "base");
  addEdge(`${model.id}:edge:lateral:front-left`, bFL, eFL, "lateral");
  addEdge(`${model.id}:edge:lateral:front-right`, bFR, eFR, "lateral");
  addEdge(`${model.id}:edge:lateral:rear-right`, bRR, eRR, "lateral");
  addEdge(`${model.id}:edge:lateral:rear-left`, bRL, eRL, "lateral");
  addEdge(`${model.id}:edge:outline:front-eave`, eFL, eFR, "top");
  addEdge(`${model.id}:edge:outline:rear-eave`, eRL, eRR, "top");
  addEdge(`${model.id}:edge:outline:left-cheek-eave`, eFL, eRL, "top");
  addEdge(`${model.id}:edge:outline:right-cheek-eave`, eFR, eRR, "top");
  addEdge(`${model.id}:edge:ridge`, ridgeAIndex, ridgeBIndex, "top");
  addEdge(`${model.id}:edge:roof:left-front`, eFL, ridgeLeftIndex, "other");
  addEdge(`${model.id}:edge:roof:left-rear`, eRL, ridgeLeftIndex, "other");
  addEdge(`${model.id}:edge:roof:right-front`, eFR, ridgeRightIndex, "other");
  addEdge(`${model.id}:edge:roof:right-rear`, eRR, ridgeRightIndex, "other");
  addEdge(`${model.id}:edge:flashing:front`, bFL, bFR, "base");
  addEdge(`${model.id}:edge:flashing:rear`, bRL, bRR, "base");
  if (apexIndex != null) {
    addEdge(`${model.id}:edge:ridge:left`, ridgeLeftIndex, apexIndex, "top");
    addEdge(`${model.id}:edge:ridge:right`, apexIndex, ridgeRightIndex, "top");
  }
  if (model.hipsPx) {
    addEdge(`${model.id}:edge:hip:left`, eFL, apexIndex ?? ridgeLeftIndex, "other");
    addEdge(`${model.id}:edge:hip:right`, eFR, apexIndex ?? ridgeRightIndex, "other");
  }

  const positions = vertices.map((v) => v.position);
  const centroid = centroidPoints(positions);
  const faces: VolumeFace3D[] = [];
  const addFace = (id: string, kind: VolumeFace3D["kind"], cycle: readonly number[]): void => {
    const face = orientedFace(id, kind, cycle, positions, centroid);
    if (face) faces.push(face);
  };

  addFace(`${model.id}:face:base`, "base", [bFL, bRL, bRR, bFR]);
  addFace(`${model.id}:face:wall:front`, "side", [bFL, bFR, eFR, eFL]);
  addFace(`${model.id}:face:wall:rear`, "side", [bRL, eRL, eRR, bRR]);
  addFace(`${model.id}:face:wall:cheek:left:lower`, "side", [bFL, eFL, eRL, bRL]);
  addFace(`${model.id}:face:wall:cheek:left:gable`, "side", [eFL, ridgeLeftIndex, eRL]);
  addFace(`${model.id}:face:wall:cheek:right:lower`, "side", [bFR, bRR, eRR, eFR]);
  addFace(`${model.id}:face:wall:cheek:right:gable`, "side", [eFR, eRR, ridgeRightIndex]);
  if (apexIndex != null && apexIndex !== ridgeLeftIndex && apexIndex !== ridgeRightIndex) {
    addFace(`${model.id}:face:roof:left:front`, "top", [eFL, eFR, apexIndex, ridgeLeftIndex]);
    addFace(`${model.id}:face:roof:right:front`, "top", [eFR, ridgeRightIndex, apexIndex]);
    addFace(`${model.id}:face:roof:left:rear`, "top", [eRL, ridgeLeftIndex, apexIndex]);
    addFace(`${model.id}:face:roof:right:rear`, "top", [eRL, apexIndex, ridgeRightIndex, eRR]);
  } else {
    addFace(`${model.id}:face:roof:left:front-slope`, "top", [eFL, eFR, ridgeRightIndex, ridgeLeftIndex]);
    addFace(`${model.id}:face:roof:right:rear-slope`, "top", [eRL, ridgeLeftIndex, ridgeRightIndex, eRR]);
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
    meshStrategy: "architectural_v1",
  };
}
