import { describe, expect, it } from "vitest";
import { buildRoofExtensionV1FromSource } from "../buildRoofExtensionV1FromSource";
import type { RoofExtensionSource2D } from "../roofExtensionSource";
import { WORLD_FIXTURE, makeSupportPatch } from "./roofExtensionVolumeTestUtils";

function makeSource(overrides: Partial<RoofExtensionSource2D> = {}): RoofExtensionSource2D {
  return {
    id: "ext-c6",
    kind: "dormer",
    sourceIndex: 0,
    stage: null,
    visualModel: null,
    supportPanId: "pan-c6",
    contour: [
      { x: 10, y: 10, heightRelM: 0 },
      { x: 60, y: 10, heightRelM: 0 },
      { x: 60, y: 50, heightRelM: 0 },
      { x: 10, y: 50, heightRelM: 0 },
    ],
    ridge: {
      a: { x: 10, y: 25, heightRelM: null },
      b: { x: 60, y: 25, heightRelM: null },
    },
    hips: null,
    apexVertex: null,
    ridgeHeightRelM: 1.0,
    wallHeightM: 0.4,
    hadLegacyCanonicalDormerGeometry: false,
    heightReference: "support_plane_normal",
    warnings: [],
    ...overrides,
  };
}

describe("C6 -- vertical_from_main_roof conversion dans buildRoofExtensionV1FromSource", () => {
  it("support_plane_normal : ridgeH n'est pas modifie", () => {
    const patch = makeSupportPatch("pan-c6", 30);
    const res = buildRoofExtensionV1FromSource({
      source: makeSource({ heightReference: "support_plane_normal" }),
      supportPatch: patch,
      ...WORLD_FIXTURE,
    });
    expect(res.model).not.toBeNull();
    expect(res.model!.dimensions.totalHeightM).toBeCloseTo(1.0, 5);
  });

  it("vertical_from_main_roof + pan 30deg : ridgeH *= cos(30deg) ~= 0.866", () => {
    const patch = makeSupportPatch("pan-c6", 30);
    const cos30 = Math.cos(30 * Math.PI / 180); // ~0.866
    const res = buildRoofExtensionV1FromSource({
      source: makeSource({ heightReference: "vertical_from_main_roof" }),
      supportPatch: patch,
      ...WORLD_FIXTURE,
    });
    expect(res.model).not.toBeNull();
    expect(res.model!.dimensions.totalHeightM).toBeCloseTo(1.0 * cos30, 3);
  });

  it("vertical_from_main_roof + pan 0deg (plat) : cos(0)=1, pas de changement", () => {
    const patch = makeSupportPatch("pan-c6", 0);
    const res = buildRoofExtensionV1FromSource({
      source: makeSource({ heightReference: "vertical_from_main_roof" }),
      supportPatch: patch,
      ...WORLD_FIXTURE,
    });
    expect(res.model).not.toBeNull();
    expect(res.model!.dimensions.totalHeightM).toBeCloseTo(1.0, 5);
  });

  it("vertical_from_main_roof : wallHeightM est aussi converti", () => {
    const patch = makeSupportPatch("pan-c6", 30);
    const cos30 = Math.cos(30 * Math.PI / 180);
    const res = buildRoofExtensionV1FromSource({
      source: makeSource({ heightReference: "vertical_from_main_roof", wallHeightM: 0.4 }),
      supportPatch: patch,
      ...WORLD_FIXTURE,
    });
    expect(res.model).not.toBeNull();
    expect(res.model!.dimensions.wallHeightM).toBeCloseTo(0.4 * cos30, 3);
  });

  it("heightReference null (inconnu) : traite comme support_plane_normal, pas de conversion", () => {
    const patch = makeSupportPatch("pan-c6", 30);
    const res = buildRoofExtensionV1FromSource({
      source: makeSource({ heightReference: null }),
      supportPatch: patch,
      ...WORLD_FIXTURE,
    });
    expect(res.model).not.toBeNull();
    expect(res.model!.dimensions.totalHeightM).toBeCloseTo(1.0, 5);
  });
});
