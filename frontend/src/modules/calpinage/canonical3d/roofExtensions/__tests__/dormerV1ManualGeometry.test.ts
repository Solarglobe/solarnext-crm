import { describe, expect, it } from "vitest";
import { buildArchitecturalDormerV1Topology } from "../buildArchitecturalDormerV1Topology";
import { buildRoofExtensionV1FromSource } from "../buildRoofExtensionV1FromSource";
import { projectRoofExtensionToSupportPlane } from "../projectRoofExtensionToSupportPlane";
import type { RoofExtensionSource2D } from "../roofExtensionSource";
import type { Vector3 } from "../../types/primitives";
import type { RoofPlanePatch3D } from "../../types/roof-surface";

const WORLD_FIXTURE = { metersPerPixel: 1, northAngleDeg: 0 };
const HEIGHT_EPS_M = 1e-3;
const PLANARITY_EPS = 1e-6;

function makeHorizontalSupportPatch(): RoofPlanePatch3D {
  return {
    id: "test-pan-1",
    topologyRole: "primary_shell",
    boundaryVertexIds: ["test-pan-1:v0", "test-pan-1:v1", "test-pan-1:v2", "test-pan-1:v3"],
    boundaryEdgeIds: ["test-pan-1:e0", "test-pan-1:e1", "test-pan-1:e2", "test-pan-1:e3"],
    cornersWorld: [
      { x: -2, y: -1, z: 0 },
      { x: 2, y: -1, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: -2, y: 3, z: 0 },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 },
    },
    normal: { x: 0, y: 0, z: 1 },
    equation: { normal: { x: 0, y: 0, z: 1 }, d: 0 },
    boundaryCycleWinding: "unspecified",
    tiltDeg: 0,
    centroid: { x: 0, y: 1, z: 0 },
    surface: { areaM2: 16 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:dormer-v1-manual" },
    quality: { confidence: "high", diagnostics: [] },
  };
}

function makeManualDormerSource(): RoofExtensionSource2D {
  return {
    id: "manual-dormer-v1",
    kind: "dormer",
    sourceIndex: 0,
    stage: "COMPLETE",
    visualModel: null,
    supportPanId: "test-pan-1",
    contour: [
      { x: -1.0, y: 0.0, heightRelM: 0 },
      { x: 1.0, y: 0.0, heightRelM: 0 },
      { x: 0.25, y: 1.8, heightRelM: 0 },
      { x: -0.25, y: 1.8, heightRelM: 0 },
    ],
    ridge: {
      a: { x: -0.15, y: 1.5, heightRelM: null },
      b: { x: 0.15, y: 1.5, heightRelM: null },
    },
    hips: null,
    apexVertex: null,
    ridgeHeightRelM: 0.8,
    wallHeightM: 0,
    hadLegacyCanonicalDormerGeometry: false,
    heightReference: "support_plane_normal",
    warnings: [],
  };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function signedHeightAbovePatch(point: Vector3, patch: RoofPlanePatch3D): number {
  return dot(patch.equation.normal, point) + patch.equation.d;
}

describe("dormer V1 manuel -- invariants geometriques", () => {
  it("projette le contour sur le pan, eleve le faitage et garde wallHeightM=0 sans muralettes", () => {
    const supportPatch = makeHorizontalSupportPatch();
    const source = makeManualDormerSource();
    const projected = projectRoofExtensionToSupportPlane(source, supportPatch, WORLD_FIXTURE);
    expect(projected).not.toBeNull();

    const built = buildRoofExtensionV1FromSource({
      source,
      supportPatch,
      ...WORLD_FIXTURE,
    });
    expect(built.model).not.toBeNull();
    expect(built.model!.dimensions.wallHeightM).toBe(0);

    const topology = buildArchitecturalDormerV1Topology(built.model!, projected!);
    expect(topology).not.toBeNull();

    for (const point of projected!.contour) {
      expect(Math.abs(signedHeightAbovePatch(point.base, supportPatch))).toBeLessThan(HEIGHT_EPS_M);
      expect(Math.abs(signedHeightAbovePatch(point.top, supportPatch))).toBeLessThan(HEIGHT_EPS_M);
    }
    expect(Math.abs(signedHeightAbovePatch(projected!.ridge.a.top, supportPatch) - 0.8)).toBeLessThan(HEIGHT_EPS_M);
    expect(Math.abs(signedHeightAbovePatch(projected!.ridge.b.top, supportPatch) - 0.8)).toBeLessThan(HEIGHT_EPS_M);

    for (const corner of ["front-left", "front-right", "rear-right", "rear-left"]) {
      const base = topology!.vertices.find((v) => v.id.endsWith(`:base:${corner}`));
      const eave = topology!.vertices.find((v) => v.id.endsWith(`:eave:${corner}`));
      expect(base).toBeTruthy();
      expect(eave).toBeTruthy();
      expect(distance(base!.position, eave!.position)).toBeLessThan(HEIGHT_EPS_M);
    }

    const dormerFaces = topology!.faces.filter((face) => face.kind !== "base");
    expect(dormerFaces).toHaveLength(4);
    expect(dormerFaces.filter((face) => face.kind === "side" && face.vertexIndexCycle.length === 3)).toHaveLength(2);

    const roofQuads = dormerFaces.filter((face) => face.kind === "top" && face.vertexIndexCycle.length === 4);
    expect(roofQuads).toHaveLength(2);
    for (const quad of roofQuads) {
      const [ia, ib, ic, id] = quad.vertexIndexCycle;
      const a = topology!.vertices[ia!]!.position;
      const b = topology!.vertices[ib!]!.position;
      const c = topology!.vertices[ic!]!.position;
      const d = topology!.vertices[id!]!.position;
      const normal = cross(sub(b, a), sub(c, a));
      expect(Math.abs(dot(normal, sub(d, a)))).toBeLessThan(PLANARITY_EPS);
    }
  });
});
