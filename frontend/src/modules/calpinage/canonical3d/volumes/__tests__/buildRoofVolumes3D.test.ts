import { describe, expect, it } from "vitest";
import type { PlaneEquation } from "../../types/plane";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { buildRoofVolumes3D } from "../buildRoofVolumes3D";
import { validateRoofObstacleVolume3D } from "../validateRoofVolume";
import { dot3 } from "../../utils/math3";

/** Pan incliné minimal : z ≈ 10 + 0.25·y (normale unitaire + équation cohérentes). */
function makeSlopedTestPatch(id: string): RoofPlanePatch3D {
  const nx = 0;
  const ny = -0.25;
  const nz = 1;
  const len = Math.hypot(ny, nz);
  const normal = { x: nx, y: ny / len, z: nz / len };
  const equation: PlaneEquation = { normal, d: -10 * normal.z };
  const origin = { x: 0, y: 0, z: 10 };
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
    boundaryVertexIds: ["tv1", "tv2", "tv3"],
    boundaryEdgeIds: ["te1", "te2", "te3"],
    cornersWorld: [
      { x: 0, y: 0, z: 10 },
      { x: 1, y: 0, z: 10 },
      { x: 0, y: 1, z: 10.25 },
    ],
    localFrame: {
      role: "roof_face",
      origin,
      xAxis,
      yAxis,
      zAxis: { ...normal },
    },
    normal,
    equation,
    boundaryCycleWinding: "unspecified",
    centroid: origin,
    surface: { areaM2: 50 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:makeSlopedTestPatch" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

describe("buildRoofVolumes3D", () => {
  it("produit un prisme obstacle avec faces, arêtes, bbox et volume cohérents (footprint WORLD)", () => {
    const { obstacleVolumes, extensionVolumes, globalQuality } = buildRoofVolumes3D({
      obstacles: [
        {
          id: "ch-1",
          kind: "chimney",
          structuralRole: "obstacle_structuring",
          heightM: 2,
          footprint: {
            mode: "world",
            footprintWorld: [
              { x: 0, y: 0, z: 10 },
              { x: 1, y: 0, z: 10 },
              { x: 1, y: 0.5, z: 10 },
              { x: 0, y: 0.5, z: 10 },
            ],
          },
          relatedPlanePatchIds: ["pan-a"],
        },
      ],
      extensions: [],
    });

    expect(extensionVolumes).toHaveLength(0);
    expect(obstacleVolumes).toHaveLength(1);
    const o = obstacleVolumes[0];
    expect(o.vertices.length).toBe(8);
    expect(o.edges.length).toBeGreaterThan(10);
    expect(o.faces.length).toBeGreaterThan(6);
    expect(o.volumeM3).toBeGreaterThan(0);
    expect(o.surfaceAreaM2).toBeGreaterThan(0);
    expect(o.relatedPlanePatchIds).toEqual(["pan-a"]);
    expect(o.extrusion.mode).toBe("vertical_world_z");

    const { min, max } = o.bounds;
    for (const vx of o.vertices) {
      const p = vx.position;
      expect(p.x).toBeGreaterThanOrEqual(min.x - 1e-9);
      expect(p.x).toBeLessThanOrEqual(max.x + 1e-9);
    }

    expect(validateRoofObstacleVolume3D(o)).toHaveLength(0);
    expect(globalQuality.confidence).toBe("high");
  });

  it("produit une extension volumique avec rôle roof_extension", () => {
    const { extensionVolumes } = buildRoofVolumes3D({
      obstacles: [],
      extensions: [
        {
          id: "dorm-1",
          kind: "dormer",
          heightM: 1.5,
          footprint: {
            mode: "world",
            footprintWorld: [
              { x: 5, y: 5, z: 12 },
              { x: 6, y: 5, z: 12 },
              { x: 6, y: 6, z: 12 },
              { x: 5, y: 6, z: 12 },
            ],
          },
          relatedPlanePatchIds: ["pan-main"],
        },
      ],
    });

    expect(extensionVolumes).toHaveLength(1);
    expect(extensionVolumes[0].structuralRole).toBe("roof_extension");
    expect(extensionVolumes[0].volumeM3).toBeGreaterThan(0);
  });

  it("mappe une empreinte image px + baseElevationM vers un prisme WORLD", () => {
    const { obstacleVolumes } = buildRoofVolumes3D({
      obstacles: [
        {
          id: "vmc-1",
          kind: "hvac",
          structuralRole: "obstacle_simple",
          heightM: 0.4,
          footprint: {
            mode: "image_px",
            polygonPx: [
              { xPx: 0, yPx: 0 },
              { xPx: 10, yPx: 0 },
              { xPx: 10, yPx: 10 },
              { xPx: 0, yPx: 10 },
            ],
            metersPerPixel: 0.05,
            northAngleDeg: 0,
            baseElevationM: 9,
          },
        },
      ],
      extensions: [],
    });

    expect(obstacleVolumes).toHaveLength(1);
    expect(obstacleVolumes[0].baseElevationM).toBe(9);
    expect(obstacleVolumes[0].footprintWorld[0].z).toBe(9);
  });

  it("ancre sur pan incliné (auto) : extrusion le long de la normale + roofAttachment renseigné", () => {
    const patch = makeSlopedTestPatch("pan-slope");
    const { obstacleVolumes } = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "chem-incline",
            kind: "chimney",
            structuralRole: "obstacle_structuring",
            heightM: 1,
            footprint: {
              mode: "world",
              footprintWorld: [
                { x: 0, y: 0, z: 10 },
                { x: 1, y: 0, z: 10 },
                { x: 1, y: 0.5, z: 10 },
                { x: 0, y: 0.5, z: 10 },
              ],
            },
            relatedPlanePatchIds: ["pan-slope"],
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patch] }
    );

    expect(obstacleVolumes).toHaveLength(1);
    const o = obstacleVolumes[0];
    expect(o.extrusion.mode).toBe("along_pan_normal");
    expect(o.roofAttachment.primaryPlanePatchId).toBe("pan-slope");
    expect(o.roofAttachment.extrusionChoice).toBe("along_pan_normal");
    expect(o.roofAttachment.anchorKind).toMatch(/anchored_/);
    const u = o.extrusion.directionWorld;
    const un = Math.hypot(u.x, u.y, u.z);
    expect(un).toBeGreaterThan(0.99);
    expect(Math.abs(dot3(u, patch.normal) - 1)).toBeLessThan(1e-6);
    expect(o.quality.diagnostics.some((d) => d.code === "VOLUME_EXTRUSION_MODE")).toBe(true);
    expect(validateRoofObstacleVolume3D(o)).toHaveLength(0);
  });

  it("keeps obstacle footprint X/Y fixed while anchoring Z on a sloped roof plane", () => {
    const patch = makeSlopedTestPatch("pan-slope-xy");
    const source = [
      { x: 2, y: 1, z: 10 },
      { x: 3, y: 1, z: 10 },
      { x: 3, y: 2, z: 10 },
      { x: 2, y: 2, z: 10 },
    ];
    const xyLocked = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "xy-lock",
            kind: "chimney",
            structuralRole: "obstacle_structuring",
            heightM: 1,
            footprint: { mode: "world", footprintWorld: source },
            relatedPlanePatchIds: ["pan-slope-xy"],
            extrusionPreference: "hybrid_vertical_on_plane",
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patch] }
    ).obstacleVolumes[0]!;

    for (let i = 0; i < source.length; i++) {
      expect(xyLocked.footprintWorld[i]!.x).toBeCloseTo(source[i]!.x, 10);
      expect(xyLocked.footprintWorld[i]!.y).toBeCloseTo(source[i]!.y, 10);
    }
  });

  it("vertical_world_z preference keeps world +Z even when a roof plane is provided", () => {
    const patch = makeSlopedTestPatch("pan-slope-2");
    const { obstacleVolumes } = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "box",
            kind: "other",
            structuralRole: "obstacle_simple",
            heightM: 0.5,
            footprint: {
              mode: "world",
              footprintWorld: [
                { x: 0, y: 0, z: 10 },
                { x: 1, y: 0, z: 10 },
                { x: 0.5, y: 1, z: 10 },
              ],
            },
            relatedPlanePatchIds: ["pan-slope-2"],
            extrusionPreference: "vertical_world_z",
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patch] }
    );

    const o = obstacleVolumes[0];
    expect(o.extrusion.mode).toBe("vertical_world_z");
    expect(o.extrusion.directionWorld.z).toBe(1);
    expect(o.roofAttachment.anchorKind).toBe("fallback_world_vertical");
  });

  it("hybrid : base projetée sur le pan, extrusion +Z monde", () => {
    const patch = makeSlopedTestPatch("pan-hyb");
    const { obstacleVolumes } = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "vmc-hyb",
            kind: "hvac",
            structuralRole: "obstacle_simple",
            heightM: 0.3,
            footprint: {
              mode: "world",
              footprintWorld: [
                { x: 2, y: 1, z: 10 },
                { x: 3, y: 1, z: 10 },
                { x: 3, y: 2, z: 10 },
                { x: 2, y: 2, z: 10 },
              ],
            },
            relatedPlanePatchIds: ["pan-hyb"],
            extrusionPreference: "hybrid_vertical_on_plane",
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patch] }
    );

    const o = obstacleVolumes[0];
    expect(o.extrusion.mode).toBe("hybrid_vertical_on_plane");
    expect(o.extrusion.directionWorld.x).toBe(0);
    expect(o.extrusion.directionWorld.y).toBe(0);
    expect(o.extrusion.directionWorld.z).toBe(1);
    expect(o.roofAttachment.extrusionChoice).toBe("hybrid_vertical_base_on_plane");
  });

  it("garde le dessus horizontal pour un obstacle physique sur pan incline", () => {
    const patch = makeSlopedTestPatch("pan-flat-top");
    const { obstacleVolumes } = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "chimney-flat-top",
            kind: "chimney",
            structuralRole: "obstacle_structuring",
            visualRole: "physical_roof_body",
            heightM: 1.8,
            footprint: {
              mode: "world",
              footprintWorld: [
                { x: 2, y: 1, z: 10 },
                { x: 3, y: 1, z: 10 },
                { x: 3, y: 2, z: 10 },
                { x: 2, y: 2, z: 10 },
              ],
            },
            relatedPlanePatchIds: ["pan-flat-top"],
            extrusionPreference: "hybrid_vertical_on_plane",
            topSurfaceMode: "horizontal_flat",
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patch] },
    );

    const o = obstacleVolumes[0]!;
    const n = o.footprintWorld.length;
    const baseZ = o.vertices.slice(0, n).map((v) => v.position.z);
    const topZ = o.vertices.slice(n).map((v) => v.position.z);
    expect(new Set(topZ.map((z) => z.toFixed(6))).size).toBe(1);
    expect(Math.max(...baseZ) - Math.min(...baseZ)).toBeGreaterThan(0.1);
    expect(topZ[0]).toBeCloseTo(Math.max(...baseZ) + 1.8, 6);
    expect(validateRoofObstacleVolume3D(o)).toHaveLength(0);
  });

  it("pan introuvable : primary_plane_not_found", () => {
    const { obstacleVolumes } = buildRoofVolumes3D({
      obstacles: [
        {
          id: "orphan",
          kind: "other",
          structuralRole: "obstacle_simple",
          heightM: 1,
          footprint: {
            mode: "world",
            footprintWorld: [
              { x: 0, y: 0, z: 5 },
              { x: 1, y: 0, z: 5 },
              { x: 0.5, y: 1, z: 5 },
            ],
          },
          relatedPlanePatchIds: ["missing-plane-id"],
        },
      ],
      extensions: [],
    });

    expect(obstacleVolumes[0].roofAttachment.anchorKind).toBe("primary_plane_not_found");
    expect(obstacleVolumes[0].extrusion.mode).toBe("vertical_world_z");
  });
});
