import { describe, expect, it } from "vitest";
import { buildRoofExtensionV1FromSource } from "../buildRoofExtensionV1FromSource";
import type { RoofExtensionSource2D } from "../roofExtensionSource";
import { makeSupportPatch } from "./roofExtensionVolumeTestUtils";

function makeSource(overrides: Partial<RoofExtensionSource2D> = {}): RoofExtensionSource2D {
  return {
    id: "ext-m15",
    kind: "gable",
    sourceIndex: 0,
    stage: null,
    visualModel: null,
    supportPanId: "pan1",
    contour: [
      { x: 0, y: 0, heightRelM: 0 },
      { x: 4, y: 0, heightRelM: 0 },
      { x: 4, y: 3, heightRelM: 0 },
      { x: 0, y: 3, heightRelM: 0 },
    ],
    ridge: {
      a: { x: 0, y: 1.5, heightRelM: 0 },
      b: { x: 4, y: 1.5, heightRelM: 0 },
    },
    hips: null,
    apexVertex: null,
    ridgeHeightRelM: 0,
    wallHeightM: null,
    heightReference: "support_plane_normal",
    hadLegacyCanonicalDormerGeometry: false,
    warnings: [],
    ...overrides,
  };
}

describe("M15 -- ROOF_EXTENSION_V1_FLAT_ROOF_FALLBACK warning quand roofHeightM < 0.05", () => {
  it("M15a : ridgeHeightRelM=0 => roofHeightM=0 => warning FLAT_ROOF_FALLBACK emis", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource({ ridgeHeightRelM: 0 }),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    const warn = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FLAT_ROOF_FALLBACK");
    expect(warn).toBeTruthy();
    expect(warn!.severity).toBe("warning");
    // Ne bloque pas la construction
    expect(result.model).not.toBeNull();
  });

  it("M15b : ridgeHeightRelM=0.04 (< 0.05) => warning emis", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource({ ridgeHeightRelM: 0.04 }),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    const warn = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FLAT_ROOF_FALLBACK");
    expect(warn).toBeTruthy();
    expect(result.model).not.toBeNull();
  });

  it("M15c : ridgeHeightRelM=1.5 (wall=0.45, roofHeight=1.05) => pas de warning", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource({ ridgeHeightRelM: 1.5 }),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    const warn = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FLAT_ROOF_FALLBACK");
    expect(warn).toBeUndefined();
  });

  it("M15d : wallHeightM explicite = ridgeH => roofHeightM=0 => warning", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource({ ridgeHeightRelM: 0.8, wallHeightM: 0.8 }),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    const warn = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FLAT_ROOF_FALLBACK");
    expect(warn).toBeTruthy();
    expect(result.model).not.toBeNull();
  });

  it("M15e : ridgeHeightRelM=0.05 exactement => roofHeight >= 0.05 => pas de warning", () => {
    const patch = makeSupportPatch("pan1", 0);
    // wallHeight default = min(0.45, 0.05) = 0.05, roofHeight = 0.05 - 0.05 = 0 => warn
    // Actually ridgeH=0.05, wallH=min(0.45,0.05)=0.05, roofHeight=0 => warns.
    // Test the boundary from the other side: wallHeightM=0, ridgeH=0.05 => roofHeight=0.05 => no warn.
    const result = buildRoofExtensionV1FromSource({
      source: makeSource({ ridgeHeightRelM: 0.05, wallHeightM: 0 }),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    const warn = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FLAT_ROOF_FALLBACK");
    expect(warn).toBeUndefined();
  });
});
