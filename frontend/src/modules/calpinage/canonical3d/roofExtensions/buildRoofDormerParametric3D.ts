import type { GeometryDiagnostic } from "../types/quality";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { AxisAlignedBounds3D, VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "../types/volumetric-mesh";
import type { StableEntityId, Vector3 } from "../types/primitives";
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from "../utils/math3";
import type { RoofDormerParametricModel, RoofDormerParametricPoint2D } from "./roofDormerParametricModel";
import {
  roofDormerParametricFootprintCycle,
  roofDormerParametricHasBlockingErrors,
  validateRoofDormerParametricModel,
} from "./roofDormerParametricValidation";

export interface RoofDormerParametricMeshParts {
  readonly walls: readonly StableEntityId[];
  readonly cheekWalls: readonly StableEntityId[];
  readonly facadeWalls: readonly StableEntityId[];
  readonly dormerRoof: readonly StableEntityId[];
  readonly seams: readonly StableEntityId[];
  readonly flashing: readonly StableEntityId[];
}

export interface RoofDormerParametricRuntimeGeometry {
  readonly version: "roof_dormer_parametric_runtime_geometry_v1";
  readonly modelId: StableEntityId;
  readonly supportPanId: StableEntityId;
  readonly heightReference: "support_plane_normal";
  readonly vertices: readonly VolumeVertex3D[];
  readonly edges: readonly VolumeEdge3D[];
  readonly faces: readonly VolumeFace3D[];
  readonly bounds: AxisAlignedBounds3D;
  readonly centroid: Vector3;
  readonly surfaceAreaM2: number;
  readonly volumeM3: number;
  readonly footprintWorld: readonly Vector3[];
  readonly parts: RoofDormerParametricMeshParts;
  readonly preparedUses: RoofDormerParametricModel["preparedUses"];
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export interface BuildRoofDormerParametric3DResult {
  readonly geometry: RoofDormerParametricRuntimeGeometry | null;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

const EPS = 1e-7;

function diag(code: string, severity: GeometryDiagnostic["severity"], message: string, extensionId: string): GeometryDiagnostic {
  return { code, severity, message, context: { extensionId } };
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
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

function centroid(points: readonly Vector3[]): Vector3 {
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

function faceAreaNormal(cycle: readonly number[], positions: readonly Vector3[]): { areaM2: number; normal: Vector3 | null } {
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

function faceCenter(cycle: readonly number[], positions: readonly Vector3[]): Vector3 {
  return centroid(cycle.map((i) => positions[i]!));
}

function orientedFace(
  id: string,
  kind: VolumeFace3D["kind"],
  rawCycle: readonly number[],
  positions: readonly Vector3[],
  solidCentroid: Vector3,
): VolumeFace3D | null {
  const initial = faceAreaNormal(rawCycle, positions);
  if (!initial.normal || initial.areaM2 < EPS) return null;
  const center = faceCenter(rawCycle, positions);
  const outward = dot3(initial.normal, sub3(center, solidCentroid)) >= 0;
  const cycle = outward ? rawCycle : [...rawCycle].reverse();
  const final = outward ? initial : faceAreaNormal(cycle, positions);
  if (!final.normal || final.areaM2 < EPS) return null;
  return { id, kind, vertexIndexCycle: cycle, outwardUnitNormal: final.normal, areaM2: final.areaM2 };
}

function signedTetraVolume(a: Vector3, b: Vector3, c: Vector3): number {
  return dot3(a, cross3(b, c)) / 6;
}

function computeVolumeM3(positions: readonly Vector3[], faces: readonly VolumeFace3D[]): number {
  let volume = 0;
  for (const face of faces) {
    const cycle = face.vertexIndexCycle;
    if (cycle.length < 3) continue;
    const a = positions[cycle[0]!]!;
    for (let i = 1; i < cycle.length - 1; i++) {
      volume += signedTetraVolume(a, positions[cycle[i]!]!, positions[cycle[i + 1]!]!);
    }
  }
  return Math.abs(volume);
}

function projectAnchorToSupportPlane(model: RoofDormerParametricModel, patch: RoofPlanePatch3D): Vector3 {
  const distance = dot3(patch.normal, model.anchorWorld) + patch.equation.d;
  return sub3(model.anchorWorld, scale3(patch.normal, distance));
}

function tangentAxis(axis: Vector3, normal: Vector3): Vector3 | null {
  return normalize3(sub3(axis, scale3(normal, dot3(axis, normal))));
}

/** Vecteur vertical monde — les murs du chien assis poussent vers le haut, pas selon la normale du pan. */
const WORLD_UP: Vector3 = { x: 0, y: 0, z: 1 };

function buildPoint(origin: Vector3, xAxis: Vector3, yAxis: Vector3, p: RoofDormerParametricPoint2D, h: number): Vector3 {
  // Étalement UV dans le plan du pan (xAxis/yAxis tangents projetés) + hauteur verticale monde.
  return add3(add3(add3(origin, scale3(xAxis, p.uM)), scale3(yAxis, p.vM)), scale3(WORLD_UP, h));
}

export function buildRoofDormerParametric3D(
  model: RoofDormerParametricModel,
  supportPatch: RoofPlanePatch3D,
): BuildRoofDormerParametric3DResult {
  const diagnostics: GeometryDiagnostic[] = [...validateRoofDormerParametricModel(model, supportPatch)];
  if (roofDormerParametricHasBlockingErrors(diagnostics)) {
    return { geometry: null, diagnostics };
  }

  const normal = normalize3(supportPatch.normal);
  const xAxis = normal ? (tangentAxis(model.orientation.uAxisWorld, normal) ?? normalize3(supportPatch.localFrame.xAxis)) : null;
  const yAxisRaw = normal && xAxis
    ? sub3(tangentAxis(model.orientation.vAxisWorld, normal) ?? supportPatch.localFrame.yAxis, scale3(xAxis, dot3(tangentAxis(model.orientation.vAxisWorld, normal) ?? supportPatch.localFrame.yAxis, xAxis)))
    : null;
  const yAxis = yAxisRaw ? normalize3(yAxisRaw) : null;
  if (!normal || !xAxis || !yAxis) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_SUPPORT_FRAME_INVALID", "error", "Repere pan invalide.", model.id));
    return { geometry: null, diagnostics };
  }
  const origin = projectAnchorToSupportPlane(model, supportPatch);

  const fp = model.footprint;
  const ridge = model.ridge;
  const hFacade = model.heights.facadeHeightM;
  const hRidge = model.heights.ridgeHeightM;

  const basePts = roofDormerParametricFootprintCycle(fp).map((p) => buildPoint(origin, xAxis, yAxis, p, 0));
  const eavePts = roofDormerParametricFootprintCycle(fp).map((p) => buildPoint(origin, xAxis, yAxis, p, hFacade));
  const ridgeFront = buildPoint(origin, xAxis, yAxis, ridge.front, hRidge);
  const ridgeRear = buildPoint(origin, xAxis, yAxis, ridge.rear, hRidge);

  const vertices: VolumeVertex3D[] = [];
  const addVertex = (id: string, position: Vector3): number => {
    const idx = vertices.length;
    vertices.push({ id, position });
    return idx;
  };

  const bFL = addVertex(`${model.id}:base:front-left`, basePts[0]!);
  const bFR = addVertex(`${model.id}:base:front-right`, basePts[1]!);
  const bRR = addVertex(`${model.id}:base:rear-right`, basePts[2]!);
  const bRL = addVertex(`${model.id}:base:rear-left`, basePts[3]!);
  const eFL = addVertex(`${model.id}:eave:front-left`, eavePts[0]!);
  const eFR = addVertex(`${model.id}:eave:front-right`, eavePts[1]!);
  const eRR = addVertex(`${model.id}:eave:rear-right`, eavePts[2]!);
  const eRL = addVertex(`${model.id}:eave:rear-left`, eavePts[3]!);
  const rF = addVertex(`${model.id}:ridge:front`, ridgeFront);
  const rR = addVertex(`${model.id}:ridge:rear`, ridgeRear);

  const edges: VolumeEdge3D[] = [
    { id: `${model.id}:edge:base:front`, vertexAIndex: bFL, vertexBIndex: bFR, kind: "base" },
    { id: `${model.id}:edge:base:right`, vertexAIndex: bFR, vertexBIndex: bRR, kind: "base" },
    { id: `${model.id}:edge:base:rear`, vertexAIndex: bRR, vertexBIndex: bRL, kind: "base" },
    { id: `${model.id}:edge:base:left`, vertexAIndex: bRL, vertexBIndex: bFL, kind: "base" },
    { id: `${model.id}:edge:wall:front-left`, vertexAIndex: bFL, vertexBIndex: eFL, kind: "lateral" },
    { id: `${model.id}:edge:wall:front-right`, vertexAIndex: bFR, vertexBIndex: eFR, kind: "lateral" },
    { id: `${model.id}:edge:wall:rear-right`, vertexAIndex: bRR, vertexBIndex: eRR, kind: "lateral" },
    { id: `${model.id}:edge:wall:rear-left`, vertexAIndex: bRL, vertexBIndex: eRL, kind: "lateral" },
    { id: `${model.id}:edge:eave:front`, vertexAIndex: eFL, vertexBIndex: eFR, kind: "top" },
    { id: `${model.id}:edge:eave:right`, vertexAIndex: eFR, vertexBIndex: eRR, kind: "top" },
    { id: `${model.id}:edge:eave:rear`, vertexAIndex: eRR, vertexBIndex: eRL, kind: "top" },
    { id: `${model.id}:edge:eave:left`, vertexAIndex: eRL, vertexBIndex: eFL, kind: "top" },
    { id: `${model.id}:edge:ridge`, vertexAIndex: rF, vertexBIndex: rR, kind: "top" },
    { id: `${model.id}:edge:hip:front-left`, vertexAIndex: eFL, vertexBIndex: rF, kind: "other" },
    { id: `${model.id}:edge:hip:front-right`, vertexAIndex: eFR, vertexBIndex: rF, kind: "other" },
    { id: `${model.id}:edge:hip:rear-left`, vertexAIndex: eRL, vertexBIndex: rR, kind: "other" },
    { id: `${model.id}:edge:hip:rear-right`, vertexAIndex: eRR, vertexBIndex: rR, kind: "other" },
  ];

  const positions = vertices.map((v) => v.position);
  const solidCentroid = centroid(positions);

  // Quand hFacade≈0 les murs verticaux sont dégénérés — on les omet.
  // Les gables et panneaux utilisent alors les points de base (h=0) directement.
  const hasFacadeWalls = hFacade > EPS;
  const gFL = hasFacadeWalls ? eFL : bFL;
  const gFR = hasFacadeWalls ? eFR : bFR;
  const gRR = hasFacadeWalls ? eRR : bRR;
  const gRL = hasFacadeWalls ? eRL : bRL;

  const faceSpecs: Array<{ id: string; kind: VolumeFace3D["kind"]; cycle: readonly number[] }> = [
    ...(hasFacadeWalls ? [
      { id: `${model.id}:face:front-wall`, kind: "side" as const, cycle: [bFL, bFR, eFR, eFL] },
      { id: `${model.id}:face:rear-wall`, kind: "side" as const, cycle: [bRR, bRL, eRL, eRR] },
      { id: `${model.id}:face:left-cheek-wall`, kind: "side" as const, cycle: [bRL, bFL, eFL, eRL] },
      { id: `${model.id}:face:right-cheek-wall`, kind: "side" as const, cycle: [bFR, bRR, eRR, eFR] },
    ] : []),
    { id: `${model.id}:face:front-gable`, kind: "side", cycle: [gFL, gFR, rF] },
    { id: `${model.id}:face:rear-gable`, kind: "side", cycle: [gRR, gRL, rR] },
    { id: `${model.id}:face:roof:left`, kind: "top", cycle: [gFL, rF, rR, gRL] },
    { id: `${model.id}:face:roof:right`, kind: "top", cycle: [gFR, gRR, rR, rF] },
  ];
  const faces = faceSpecs.flatMap((spec) => {
    const face = orientedFace(spec.id, spec.kind, spec.cycle, positions, solidCentroid);
    return face ? [face] : [];
  });
  if (faces.length < 4) {
    diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_FACE_DEGENERATE", "error", "Trop de faces degenerees.", model.id));
    return { geometry: null, diagnostics };
  }

  const wallFaceIds = hasFacadeWalls
    ? [`${model.id}:face:front-wall`, `${model.id}:face:rear-wall`, `${model.id}:face:left-cheek-wall`, `${model.id}:face:right-cheek-wall`,
       `${model.id}:face:front-gable`, `${model.id}:face:rear-gable`]
    : [`${model.id}:face:front-gable`, `${model.id}:face:rear-gable`];

  const surfaceAreaM2 = faces.reduce((sum, face) => sum + face.areaM2, 0);
  const footprintWorld = basePts;
  const geometry: RoofDormerParametricRuntimeGeometry = {
    version: "roof_dormer_parametric_runtime_geometry_v1",
    modelId: model.id,
    supportPanId: model.supportPanId,
    heightReference: "support_plane_normal",
    vertices,
    edges,
    faces,
    bounds: boundsOf(positions),
    centroid: solidCentroid,
    surfaceAreaM2,
    volumeM3: computeVolumeM3(positions, faces),
    footprintWorld,
    parts: {
      walls: wallFaceIds,
      cheekWalls: hasFacadeWalls ? [`${model.id}:face:left-cheek-wall`, `${model.id}:face:right-cheek-wall`] : [],
      facadeWalls: hasFacadeWalls ? [`${model.id}:face:front-wall`, `${model.id}:face:front-gable`, `${model.id}:face:rear-wall`, `${model.id}:face:rear-gable`] : [`${model.id}:face:front-gable`, `${model.id}:face:rear-gable`],
      dormerRoof: [`${model.id}:face:roof:left`, `${model.id}:face:roof:right`],
      seams: [`${model.id}:edge:base:front`, `${model.id}:edge:base:right`, `${model.id}:edge:base:rear`, `${model.id}:edge:base:left`],
      flashing: [`${model.id}:edge:base:front`, `${model.id}:edge:base:right`, `${model.id}:edge:base:rear`, `${model.id}:edge:base:left`],
    },
    preparedUses: model.preparedUses,
    diagnostics,
  };

  diagnostics.push(diag("ROOF_DORMER_PARAMETRIC_BUILD_OK", "info", "Dormer parametrique genere en parallele.", model.id));
  return { geometry, diagnostics };
}
