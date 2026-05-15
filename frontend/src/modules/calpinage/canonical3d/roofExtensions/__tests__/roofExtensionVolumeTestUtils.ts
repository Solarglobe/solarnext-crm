import type { PlaneEquation } from "../../types/plane";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { Vector3 } from "../../types/primitives";
import type { RoofExtensionVolume3D } from "../../types/roof-extension-volume";
import { dot3, normalize3 } from "../../utils/math3";

export const WORLD_FIXTURE = { metersPerPixel: 1, northAngleDeg: 0 };

export function makeSupportPatch(id: string, slopeDeg: number): RoofPlanePatch3D {
  const slope = Math.tan((slopeDeg * Math.PI) / 180);
  const normal = normalize3({ x: 0, y: -slope, z: 1 })!;
  const z0 = 10;
  const equation: PlaneEquation = { normal, d: -normal.z * z0 };
  const zAt = (y: number) => z0 + slope * y;
  const xAxis = { x: 1, y: 0, z: 0 };
  const yRaw = {
    x: normal.y * xAxis.z - normal.z * xAxis.y,
    y: normal.z * xAxis.x - normal.x * xAxis.z,
    z: normal.x * xAxis.y - normal.y * xAxis.x,
  };
  const yLen = Math.hypot(yRaw.x, yRaw.y, yRaw.z) || 1;
  const yAxis = { x: yRaw.x / yLen, y: yRaw.y / yLen, z: yRaw.z / yLen };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: [`${id}:v0`, `${id}:v1`, `${id}:v2`, `${id}:v3`],
    boundaryEdgeIds: [`${id}:e0`, `${id}:e1`, `${id}:e2`, `${id}:e3`],
    cornersWorld: [
      { x: 0, y: -10, z: zAt(-10) },
      { x: 10, y: -10, z: zAt(-10) },
      { x: 10, y: 0, z: zAt(0) },
      { x: 0, y: 0, z: zAt(0) },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: z0 },
      xAxis,
      yAxis,
      zAxis: { ...normal },
    },
    normal,
    equation,
    boundaryCycleWinding: "unspecified",
    centroid: { x: 5, y: -5, z: zAt(-5) },
    surface: { areaM2: 100 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:roofExtensionPatch" },
    quality: { confidence: "high", diagnostics: [] },
  };
}

export function signedDistanceToPlane(point: Vector3, eq: PlaneEquation): number {
  return dot3(eq.normal, point) + eq.d;
}

export function assertFootprintOnSupportPlane(vol: RoofExtensionVolume3D, patch: RoofPlanePatch3D): void {
  for (const p of vol.footprintWorld) {
    expect(Math.abs(signedDistanceToPlane(p, patch.equation))).toBeLessThan(1e-6);
  }
}

export function assertVertexHeightAlongNormal(
  vol: RoofExtensionVolume3D,
  patch: RoofPlanePatch3D,
  vertexIdSubstring: string,
  heightM: number,
): void {
  const vertex = vol.vertices.find((v) => v.id.includes(vertexIdSubstring));
  expect(vertex).toBeTruthy();
  expect(Math.abs(signedDistanceToPlane(vertex!.position, patch.equation) - heightM)).toBeLessThan(1e-6);
}
