import { describe, expect, it } from "vitest";
import { resolveOfficialShellFootprintRingWorld } from "../officialShellFootprintRing";
import { buildBuildingShell3DFromCalpinageRuntime } from "../buildBuildingShell3DFromCalpinageRuntime";
import type { LegacyRoofGeometryInput } from "../legacyInput";
import { imagePxToWorldHorizontalM } from "../worldMapping";
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

describe("resolveOfficialShellFootprintRingWorld", () => {
  it("même contourSource et anneau XY que buildBuildingShell3DFromCalpinageRuntime (contour state)", () => {
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
          roofRole: "contour",
          points: contourPx,
        },
      ],
    };
    const fp = resolveOfficialShellFootprintRingWorld({
      runtime,
      roofPlanePatches: patches,
      metersPerPixel: mpp,
      northAngleDeg: north,
    });
    const shell = buildBuildingShell3DFromCalpinageRuntime({
      runtime,
      roofPlanePatches: patches,
      metersPerPixel: mpp,
      northAngleDeg: north,
      legacy: minimalLegacy(),
    });
    expect(fp).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(fp!.contourSource).toBe(shell!.contourSource);
    expect(fp!.ringXY.length).toBe(4);
    const pts = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ];
    const expected = pts.map((p) => imagePxToWorldHorizontalM(p.x, p.y, mpp, north));
    const key = (p: { x: number; y: number }) => `${p.x.toFixed(9)}\u241e${p.y.toFixed(9)}`;
    const expSorted = [...expected].sort((a, b) => key(a).localeCompare(key(b)));
    const gotSorted = [...fp!.ringXY].sort((a, b) => key(a).localeCompare(key(b)));
    for (let i = 0; i < 4; i++) {
      expect(gotSorted[i]!.x).toBeCloseTo(expSorted[i]!.x, 6);
      expect(gotSorted[i]!.y).toBeCloseTo(expSorted[i]!.y, 6);
    }
  });

  it("sans contour : pas d’emprise (option A — plus de repli sur les pans)", () => {
    const patches = [makeHorizontalSquarePatch("p1", 10, 3)];
    const fp = resolveOfficialShellFootprintRingWorld({
      runtime: { contours: [] },
      roofPlanePatches: patches,
      metersPerPixel: 0.01,
      northAngleDeg: 0,
    });
    expect(fp).toBeNull();
  });

  it("sans contour : multi-pans → null (plus d’union XY)", () => {
    const a = makeHorizontalSquarePatch("pa", 10, 0);
    const b: (typeof a) = {
      ...makeHorizontalSquarePatch("pb", 10, 0),
      cornersWorld: [
        { x: 10, y: 0, z: 0 },
        { x: 20, y: 0, z: 0 },
        { x: 20, y: 10, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
      centroid: { x: 15, y: 5, z: 0 },
      equation: { normal: { x: 0, y: 0, z: 1 }, d: 0 },
      localFrame: {
        ...a.localFrame,
        origin: { x: 10, y: 0, z: 0 },
      },
    };
    const fp = resolveOfficialShellFootprintRingWorld({
      runtime: { contours: [] },
      roofPlanePatches: [a, b],
      metersPerPixel: 0.01,
      northAngleDeg: 0,
    });
    expect(fp).toBeNull();
  });
});
