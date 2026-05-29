import { describe, expect, it } from "vitest";
import { buildRoofExtensionV1FromSource } from "../buildRoofExtensionV1FromSource";
import type { RoofExtensionSource2D } from "../roofExtensionSource";
import { makeSupportPatch } from "./roofExtensionVolumeTestUtils";

function makeSource(overrides: Partial<RoofExtensionSource2D> = {}): RoofExtensionSource2D {
  return {
    id: "ext-m16",
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
      a: { x: 0, y: 1.5, heightRelM: 1.5 },
      b: { x: 4, y: 1.5, heightRelM: 1.5 },
    },
    hips: null,
    apexVertex: null,
    ridgeHeightRelM: 1.5,
    wallHeightM: null,
    heightReference: "support_plane_normal",
    hadLegacyCanonicalDormerGeometry: false,
    warnings: [],
    ...overrides,
  };
}

describe("M16 -- ROOF_EXTENSION_V1_FOOTPRINT_DEGENERATE_DEPTH : empreinte sans profondeur", () => {
  it("M16a : contour collineaire au faitage (depthM < 1e-6) => erreur bloquante, model null", () => {
    const patch = makeSupportPatch("pan1", 0);
    // Ridge along x-axis. Contour points all on the ridge line => maxDepth=0.
    const result = buildRoofExtensionV1FromSource({
      source: makeSource({
        contour: [
          { x: 0, y: 0, heightRelM: 0 },
          { x: 4, y: 0, heightRelM: 0 },
          { x: 4, y: 0, heightRelM: 0 },
          { x: 0, y: 0, heightRelM: 0 },
        ],
        ridge: {
          a: { x: 0, y: 0, heightRelM: 1.5 },
          b: { x: 4, y: 0, heightRelM: 1.5 },
        },
      }),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    expect(result.model).toBeNull();
    const diag = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FOOTPRINT_DEGENERATE_DEPTH");
    expect(diag).toBeTruthy();
    expect(diag!.severity).toBe("error");
  });

  it("M16b : empreinte normale (depth > 1e-6) => model construit, pas d'erreur de depth", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource(),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    expect(result.model).not.toBeNull();
    const diag = result.diagnostics.find((d) => d.code === "ROOF_EXTENSION_V1_FOOTPRINT_DEGENERATE_DEPTH");
    expect(diag).toBeUndefined();
  });

  it("M16c : pitchDeg n'est jamais null sur un model construit (depthM >= 1e-6)", () => {
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource(),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    expect(result.model).not.toBeNull();
    // With sufficient depth, pitchDeg must be a finite number, not null.
    expect(result.model!.roof.pitchDeg).not.toBeNull();
    expect(Number.isFinite(result.model!.roof.pitchDeg)).toBe(true);
  });
});
