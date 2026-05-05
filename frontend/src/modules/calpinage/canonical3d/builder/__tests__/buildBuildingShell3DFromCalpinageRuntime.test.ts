import { describe, expect, it } from "vitest";
import {
  buildBuildingShell3DFromCalpinageRuntime,
  WALL_TOP_CLEARANCE_M,
} from "../buildBuildingShell3DFromCalpinageRuntime";
import type { LegacyRoofGeometryInput } from "../legacyInput";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import {
  makeFlatPatchFromImageContourPx,
  makeHorizontalSquarePatch,
} from "../../__tests__/hardening/hardeningSceneFactories";

function minimalLegacy(): LegacyRoofGeometryInput {
  return {
    metersPerPixel: 0.01,
    northAngleDeg: 0,
    defaultHeightM: 5.5,
    pans: [
      {
        id: "p1",
        sourceIndex: 0,
        polygonPx: [
          { xPx: 0, yPx: 0 },
          { xPx: 1000, yPx: 0 },
          { xPx: 1000, yPx: 1000 },
        ],
      },
    ],
  };
}

describe("buildBuildingShell3DFromCalpinageRuntime", () => {
  it("emprise = contour bâti brut XY ; couronne haute suit le toit ; base horizontale (min z_roof − wallH)", () => {
    const contourPx = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ];
    const mpp = 0.01;
    const north = 0;
    const patches = [makeFlatPatchFromImageContourPx("p1", contourPx, 5, mpp, north)];
    const runtime = {
      contours: [
        {
          id: "c1",
          roofRole: "contour",
          closed: true,
          points: contourPx,
        },
      ],
    };
    const shell = buildBuildingShell3DFromCalpinageRuntime({
      runtime,
      roofPlanePatches: patches,
      metersPerPixel: mpp,
      northAngleDeg: north,
      legacy: minimalLegacy(),
    });
    expect(shell).not.toBeNull();
    expect(shell!.contourSource).toBe("CALPINAGE_STATE.contours");
    expect(shell!.vertices.length).toBe(8);
    expect(shell!.faces.length).toBeGreaterThan(4);
    expect(shell!.topElevationM).toBeLessThanOrEqual(5 + 1e-6);
    expect(shell!.baseElevationM).toBeLessThan(shell!.topElevationM);
  });

  it("sans contour : pas de shell (option A)", () => {
    const patches = [makeHorizontalSquarePatch("p1", 10, 3)];
    const shell = buildBuildingShell3DFromCalpinageRuntime({
      runtime: { contours: [] },
      roofPlanePatches: patches,
      metersPerPixel: 0.01,
      northAngleDeg: 0,
      legacy: minimalLegacy(),
    });
    expect(shell).toBeNull();
  });

  /**
   * Non-régression reload : `loadCalpinageState` imposait roofRole "main", reconnu comme contour bâti.
   */
  it("reload roofRole main : emprise = contour bâti (pas fallback plus grand pan)", () => {
    const contourPx = [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const mpp = 0.01;
    const north = 0;
    const patches = [makeFlatPatchFromImageContourPx("p1", contourPx, 5, mpp, north)];
    const runtime = {
      contours: [
        {
          id: "c-reload",
          roofRole: "main",
          closed: true,
          points: contourPx,
        },
      ],
    };
    const shell = buildBuildingShell3DFromCalpinageRuntime({
      runtime,
      roofPlanePatches: patches,
      metersPerPixel: mpp,
      northAngleDeg: north,
      legacy: minimalLegacy(),
    });
    expect(shell).not.toBeNull();
    expect(shell!.contourSource).toBe("CALPINAGE_STATE.contours");
  });

  it("retourne null sans patches", () => {
    expect(
      buildBuildingShell3DFromCalpinageRuntime({
        runtime: {},
        roofPlanePatches: [],
        metersPerPixel: 0.01,
        northAngleDeg: 0,
        legacy: minimalLegacy(),
      }),
    ).toBeNull();
  });

  it("worldZOriginShiftM aligne la base métier ; haut suit le toit sur contour brut", () => {
    const ny = -20;
    const nz = 100;
    const nl = Math.hypot(ny, nz);
    const normal = { x: 0, y: ny / nl, z: nz / nl };
    const cornersWorld = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 2 },
      { x: 0, y: 10, z: 2 },
    ];
    const slopedPatch = {
      id: "p-slope",
      topologyRole: "primary_shell",
      boundaryVertexIds: ["v1", "v2", "v3", "v4"],
      boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
      cornersWorld,
      localFrame: {
        role: "roof_face",
        origin: { x: 0, y: 0, z: 0 },
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        zAxis: { ...normal },
      },
      normal,
      equation: { normal, d: 0 },
      boundaryCycleWinding: "unspecified",
      centroid: { x: 5, y: 5, z: 1 },
      surface: { areaM2: 100 },
      adjacentPlanePatchIds: [],
      provenance: { source: "solver", solverStep: "test" },
      quality: { confidence: "high", diagnostics: [] },
    } as RoofPlanePatch3D;

    /**
     * Pixels image : avec `north=0`, `y` monde = −yPx·mpp — rectangle monde (1,1)…(9,9) m dans le pan 0…10 × 0…10.
     */
    const runtime = {
      contours: [
        {
          id: "c1",
          roofRole: "contour",
          closed: true,
          points: [
            { x: 1, y: -1 },
            { x: 9, y: -1 },
            { x: 9, y: -9 },
            { x: 1, y: -9 },
          ],
        },
      ],
    };

    const shell = buildBuildingShell3DFromCalpinageRuntime({
      runtime,
      roofPlanePatches: [slopedPatch],
      metersPerPixel: 1,
      northAngleDeg: 0,
      legacy: minimalLegacy(),
      worldZOriginShiftM: 5,
    });
    expect(shell).not.toBeNull();
    /** Plan du pan : z = 0,2·y (coins (0,0,0)…(0,10,2)). */
    const zAt = (x: number, y: number) => 0.2 * y;
    const zc = [
      zAt(1, 1),
      zAt(9, 1),
      zAt(9, 9),
      zAt(1, 9),
    ];
    const zContourMin = Math.min(...zc);
    const zContourMax = Math.max(...zc);
    const zTopMin = zContourMin - WALL_TOP_CLEARANCE_M;
    const zTopMax = zContourMax - WALL_TOP_CLEARANCE_M;
    expect(shell!.baseElevationM).toBeCloseTo(-5, 4);
    expect(shell!.topElevationM).toBeCloseTo(zTopMax, 4);
    expect(shell!.wallHeightM).toBeCloseTo(zContourMin + 5, 4);
    const half = shell!.vertices.length / 2;
    const baseZs = shell!.vertices.slice(0, half).map((v) => v.position.z);
    expect(Math.min(...baseZs)).toBeCloseTo(Math.max(...baseZs), 6);
    const topZs = shell!.vertices.slice(half, 2 * half).map((v) => v.position.z);
    expect(Math.min(...topZs)).toBeCloseTo(zTopMin, 4);
    expect(Math.max(...topZs)).toBeCloseTo(zTopMax, 4);
  });
});
