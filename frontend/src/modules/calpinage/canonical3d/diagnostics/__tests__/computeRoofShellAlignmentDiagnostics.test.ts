/**
 * Diagnostics alignement shell / plan pan dominant — fixtures runtime réelles avec `buildingShell`.
 */

import { describe, expect, it } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntime";
import {
  computeRoofShellAlignmentDiagnostics,
  computeShellTopRingMidEdgeRoofChordErrorMaxM,
} from "../computeRoofShellAlignmentDiagnostics";

const worldRoof = {
  scale: { metersPerPixel: 0.02 },
  roof: { north: { angleDeg: 0 } },
  canonical3DWorldContract: {
    schemaVersion: 1,
    metersPerPixel: 0.02,
    northAngleDeg: 0,
    referenceFrame: "LOCAL_IMAGE_ENU" as const,
  },
  roofPans: [] as const,
};

describe("computeRoofShellAlignmentDiagnostics", () => {
  it("toit plat + shell : couronne sous zTopMin avec jeu — écart quasi nul vs plan du pan dominant", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "flat-pan",
          polygonPx: [
            { x: 100, y: 100, h: 4 },
            { x: 200, y: 100, h: 4 },
            { x: 200, y: 200, h: 4 },
            { x: 100, y: 200, h: 4 },
          ],
        },
      ],
      roof: { ...worldRoof },
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.scene?.buildingShell).toBeDefined();

    const d = computeRoofShellAlignmentDiagnostics(res.scene!);
    expect(d.ok).toBe(true);
    expect(d.dominantPanId).toBe("flat-pan");
    expect(d.topRingVertexCount).toBeGreaterThanOrEqual(3);
    expect(d.verticalGapVsDominantPlaneFullRingM).not.toBeNull();
    expect(d.verticalGapVsDominantPlaneFullRingM!.maxAbsM).toBeCloseTo(0.02, 5);
    expect(d.verticalGapVsDominantPlaneFullRingM!.meanAbsM).toBeCloseTo(0.02, 5);
    expect(d.perimeterSparseSampleCount).toBeGreaterThanOrEqual(3);
    expect(d.verticalGapVsDominantPlanePerimeterSparseM?.maxAbsM).toBeCloseTo(0.02, 5);
    const chord = computeShellTopRingMidEdgeRoofChordErrorMaxM(res.scene!);
    expect(chord).not.toBeNull();
    expect(chord!).toBeCloseTo(0.02, 4);
  });

  it("deux pans en pente (faîtage) + shell : couronne haute suit le toit → corde mi-arête ~ jeu (clearance)", () => {
    /** 255 px × 0,02 m/px = 5,10 m : entre deux échantillons du pas ~0,35 m sur le bord bas (évite x = 5,00 m déjà échantillonné). */
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "pan-large",
          polygonPx: [
            { x: 100, y: 100, h: 5 },
            { x: 255, y: 100, h: 8 },
            { x: 255, y: 200, h: 8 },
            { x: 100, y: 200, h: 5 },
          ],
        },
        {
          id: "pan-small",
          polygonPx: [
            { x: 255, y: 100, h: 8 },
            { x: 300, y: 100, h: 5 },
            { x: 300, y: 200, h: 5 },
            { x: 255, y: 200, h: 8 },
          ],
        },
      ],
      roof: { ...worldRoof },
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 200 },
            { x: 100, y: 200 },
          ],
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.scene?.buildingShell).toBeDefined();

    const d = computeRoofShellAlignmentDiagnostics(res.scene!);
    expect(d.ok).toBe(true);
    expect(d.dominantPanId).toBe("pan-large");
    expect(d.verticalGapVsDominantPlaneFullRingM).not.toBeNull();
    expect(d.topRingVertexCount).toBeGreaterThanOrEqual(4);
    const chord = computeShellTopRingMidEdgeRoofChordErrorMaxM(res.scene!);
    expect(chord).not.toBeNull();
    /** Contour bâti brut (4 sommets) : cordes mi-arêtes ≠ toit bilinéaire sur les grands côtés. */
    expect(chord!).toBeLessThanOrEqual(2.5);
    expect(d.verticalGapVsDominantPlaneFullRingM!.maxAbsM).toBeGreaterThan(0.05);
  });

  it("sans shell : diagnostic explicite", () => {
    const base = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "only",
          polygonPx: [
            { x: 100, y: 100, h: 3 },
            { x: 200, y: 100, h: 3 },
            { x: 200, y: 200, h: 3 },
            { x: 100, y: 200, h: 3 },
          ],
        },
      ],
      roof: { ...worldRoof },
      contours: [],
    });
    expect(base.ok).toBe(true);
    const scene = { ...base.scene!, buildingShell: undefined };
    const d = computeRoofShellAlignmentDiagnostics(scene);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("NO_BUILDING_SHELL");
  });
});
