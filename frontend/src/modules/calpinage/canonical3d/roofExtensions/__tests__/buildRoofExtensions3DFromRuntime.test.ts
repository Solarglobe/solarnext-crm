import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { PlaneEquation } from "../../types/plane";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { Vector3 } from "../../types/primitives";
import type { RoofExtensionVolume3D } from "../../types/roof-extension-volume";
import { dot3, normalize3, sub3 } from "../../utils/math3";
import { extensionVolumeGeometry } from "../../viewer/solarSceneThreeGeometry";
import { findClosestOccluderHit } from "../../nearShading3d/volumeRaycast";
import { buildRoofExtensions3DFromRuntime } from "../buildRoofExtensions3DFromRuntime";

const WORLD = { metersPerPixel: 1, northAngleDeg: 0 };

function makePatch(id: string, slopeDeg: number): RoofPlanePatch3D {
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

function runtimeWithExtension(points: readonly { x: number; y: number; h?: number }[], ridgeH: number) {
  return {
    roofExtensions: [
      {
        id: "rx-test",
        type: "roof_extension",
        kind: "dormer",
        visualModel: "manual_outline_gable",
        contour: { closed: true, points },
        ridge: {
          a: { x: 2, y: 1, h: ridgeH },
          b: { x: 2, y: 4, h: ridgeH },
        },
        ridgeHeightRelM: ridgeH,
      },
    ],
  };
}

function buildOne(
  patch: RoofPlanePatch3D,
  points: readonly { x: number; y: number; h?: number }[],
  ridgeH: number,
): RoofExtensionVolume3D {
  const res = buildRoofExtensions3DFromRuntime({
    runtime: runtimeWithExtension(points, ridgeH),
    roofPlanePatches: [patch],
    ...WORLD,
  });
  expect(res.extensionVolumes).toHaveLength(1);
  return res.extensionVolumes[0]!;
}

function signedDistance(point: Vector3, eq: PlaneEquation): number {
  return dot3(eq.normal, point) + eq.d;
}

function assertBaseOnPlane(vol: RoofExtensionVolume3D, patch: RoofPlanePatch3D): void {
  for (const p of vol.footprintWorld) {
    expect(Math.abs(signedDistance(p, patch.equation))).toBeLessThan(1e-6);
  }
}

function assertHeightAlongNormal(
  vol: RoofExtensionVolume3D,
  patch: RoofPlanePatch3D,
  vertexIdPart: string,
  height: number,
): void {
  const vertex = vol.vertices.find((v) => v.id.includes(vertexIdPart));
  expect(vertex).toBeTruthy();
  expect(Math.abs(signedDistance(vertex!.position, patch.equation) - height)).toBeLessThan(1e-6);
}

describe("buildRoofExtensions3DFromRuntime", () => {
  it("toit horizontal : construit depuis le contour rectangle reel, sans bbox legacy", () => {
    const patch = makePatch("pan-flat", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      1,
    );

    expect(vol.footprintWorld).toHaveLength(4);
    assertBaseOnPlane(vol, patch);
    expect(vol.extrusion.mode).toBe("along_pan_normal");
    expect(vol.topology?.heightReference).toBe("support_plane_normal");
    expect(vol.topology?.sourceContourPx.map((p) => [p.x, p.y])).toEqual([
      [1, 1],
      [3, 1],
      [3, 4],
      [1, 4],
    ]);
  });

  it("sommet apex partagé : faîtage confondu avec apex → un seul vertex 3D (pas ridge:a séparé)", () => {
    const patch = makePatch("pan-apex-merge", 0);
    const ax = 2;
    const ay = 2.5;
    const res = buildRoofExtensions3DFromRuntime({
      runtime: {
        roofExtensions: [
          {
            id: "rx-apex",
            type: "roof_extension",
            kind: "chien_assis",
            visualModel: "manual_outline_gable",
            contour: {
              closed: true,
              points: [
                { x: 1, y: 1, h: 0 },
                { x: 3, y: 1, h: 0 },
                { x: 3, y: 4, h: 0 },
                { x: 1, y: 4, h: 0 },
              ],
            },
            ridge: {
              a: { x: ax, y: ay, h: 1 },
              b: { x: 2, y: 4, h: 1 },
            },
            apexVertex: { id: "rx-apex:apex", x: ax, y: ay, h: 1 },
            ridgeHeightRelM: 1,
          },
        ],
      },
      roofPlanePatches: [patch],
      ...WORLD,
    });
    const vol = res.extensionVolumes[0]!;
    const apexMeshId = "rx-apex:rx-apex:apex";
    const apexVert = vol.vertices.find((v) => v.id === apexMeshId);
    expect(apexVert).toBeTruthy();
    expect(vol.vertices.some((v) => v.id.endsWith(":ridge:a"))).toBe(false);
    const samePos = vol.vertices.filter(
      (v) =>
        Math.abs(v.position.x - apexVert!.position.x) < 1e-5 &&
        Math.abs(v.position.y - apexVert!.position.y) < 1e-5 &&
        Math.abs(v.position.z - apexVert!.position.z) < 1e-5,
    );
    expect(samePos.length).toBe(1);
    expect(vol.topology?.apexVertexPx?.id).toBe("rx-apex:apex");
  });

  it("toit incline 30 degres : hauteur 1 m selon normale du pan, pas +Z monde", () => {
    const patch = makePatch("pan-30", 30);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      1,
    );
    const ridgeA = vol.vertices.find((v) => v.id.endsWith(":ridge:a"))!;
    const ridgeBase = {
      x: vol.topology!.sourceRidgePx.a.x,
      y: -vol.topology!.sourceRidgePx.a.y,
      z: 10 + Math.tan(Math.PI / 6) * -vol.topology!.sourceRidgePx.a.y,
    };
    const offset = sub3(ridgeA.position, ridgeBase);
    expect(Math.abs(dot3(offset, patch.normal) - 1)).toBeLessThan(1e-6);
    expect(Math.abs(offset.z - 1)).toBeGreaterThan(0.05);
  });

  it("hauteur 0 : les sommets a h=0 restent exactement poses sur le pan", () => {
    const patch = makePatch("pan-zero", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      0,
    );
    assertBaseOnPlane(vol, patch);
    for (const vertex of vol.vertices) {
      expect(Math.abs(signedDistance(vertex.position, patch.equation))).toBeLessThan(1e-6);
    }
  });

  it("hauteur 1 m : le sommet ridge est a 1 m selon la normale support", () => {
    const patch = makePatch("pan-height", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      1,
    );
    assertHeightAlongNormal(vol, patch, "ridge:a", 1);
  });

  it("preserve un contour trapeze", () => {
    const patch = makePatch("pan-trapeze", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 4, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1.5, y: 4, h: 0 },
      ],
      1,
    );
    expect(vol.footprintWorld).toHaveLength(4);
    expect(vol.topology?.sourceContourPx[1]?.x).toBe(4);
    expect(vol.topology?.sourceContourPx[2]?.x).toBe(3);
  });

  it("preserve un contour pentagone", () => {
    const patch = makePatch("pan-pentagon", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 4, y: 2.5, h: 0 },
        { x: 2.5, y: 4, h: 0 },
        { x: 1, y: 3, h: 0 },
      ],
      1,
    );
    expect(vol.footprintWorld).toHaveLength(5);
    expect(vol.topology?.sourceContourPx.map((p) => p.x)).toEqual([1, 3, 4, 2.5, 1]);
  });

  it("reload ancien : canonicalDormerGeometry legacy est ignoree", () => {
    const patch = makePatch("pan-legacy", 0);
    const runtime = runtimeWithExtension(
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      1,
    );
    runtime.roofExtensions[0] = {
      ...runtime.roofExtensions[0],
      canonicalDormerGeometry: {
        version: 2,
        vertices: [
          { id: "b0", x: 100, y: 100, h: 0 },
          { id: "b1", x: 200, y: 100, h: 0 },
          { id: "b2", x: 200, y: 200, h: 0 },
        ],
        faces: [{ id: "f", vertexIds: ["b0", "b1", "b2"] }],
      },
    } as typeof runtime.roofExtensions[number];
    const res = buildRoofExtensions3DFromRuntime({ runtime, roofPlanePatches: [patch], ...WORLD });
    const vol = res.extensionVolumes[0]!;
    expect(vol.topology?.ignoredLegacyCanonicalDormerGeometry).toBe(true);
    expect(vol.topology?.sourceContourPx.map((p) => [p.x, p.y])).toEqual([
      [1, 1],
      [3, 1],
      [3, 4],
      [1, 4],
    ]);
  });

  it("bbox viewer et shading identiques : le viewer tesselle le meme RoofExtensionVolume3D", () => {
    const patch = makePatch("pan-bbox", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      1,
    );
    const geo = extensionVolumeGeometry(vol);
    geo.computeBoundingBox();
    const bbox = geo.boundingBox!;
    expect(bbox.min.x).toBeCloseTo(vol.bounds.min.x, 6);
    expect(bbox.min.y).toBeCloseTo(vol.bounds.min.y, 6);
    expect(bbox.min.z).toBeCloseTo(vol.bounds.min.z, 6);
    expect(bbox.max.x).toBeCloseTo(vol.bounds.max.x, 6);
    expect(bbox.max.y).toBeCloseTo(vol.bounds.max.y, 6);
    expect(bbox.max.z).toBeCloseTo(vol.bounds.max.z, 6);
  });

  it("raycast consomme les memes vertices que scene.extensionVolumes", () => {
    const patch = makePatch("pan-raycast", 0);
    const vol = buildOne(
      patch,
      [
        { x: 1, y: 1, h: 0 },
        { x: 3, y: 1, h: 0 },
        { x: 3, y: 4, h: 0 },
        { x: 1, y: 4, h: 0 },
      ],
      1,
    );
    const sceneLike = { extensionVolumes: [vol] };
    expect(sceneLike.extensionVolumes[0]!.vertices).toBe(vol.vertices);
    const hit = findClosestOccluderHit(
      { x: 2, y: -2.5, z: 10.2 },
      { x: 0, y: 0, z: 1 },
      1e-9,
      10,
      [],
      sceneLike.extensionVolumes,
      true,
    );
    expect(hit?.volumeId).toBe("rx-test");
  });
});
