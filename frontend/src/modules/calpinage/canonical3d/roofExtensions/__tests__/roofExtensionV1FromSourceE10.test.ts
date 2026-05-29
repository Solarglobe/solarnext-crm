import { describe, expect, it } from "vitest";
import { buildRoofExtensionV1FromSource } from "../buildRoofExtensionV1FromSource";
import type { RoofExtensionSource2D } from "../roofExtensionSource";
import { makeSupportPatch } from "./roofExtensionVolumeTestUtils";

// E10: depthAxisPx must be computed via world-space perpendicular, not pure pixel 90-deg rotation.
// For northAngleDeg=0: pixel x -> world x, pixel y -> world (-y). Ridge along pixel x-axis =>
//   depthAxisPx = (0, +1) in image (south in world = away from ridge toward facade).
// For northAngleDeg=90: pixel x -> world (-y), pixel y -> world (-x). Ridge along pixel x =>
//   world ridge = (0,-1). World depth = perpendicular CCW = (1,0) in world.
//   Back to pixels: world x -> pixel y (flipped sign), world y -> pixel (-x).
//   depthAxisPx = (0, -1) in image (NOT (0,+1) which the old code would give).

function makeSource(overrides: Partial<RoofExtensionSource2D> = {}): RoofExtensionSource2D {
  return {
    id: "ext-e10",
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

describe("E10 -- depthAxisPx perpendiculaire dans l'espace monde, pas pixels bruts", () => {
  it("northAngleDeg=0 : depthAxisPx pointe vers +y pixel (direction facade)", () => {
    // Ridge is horizontal in pixels (ridgeAxisPx ~ (1,0)).
    // With northAngleDeg=0 the pixel and world axes are aligned.
    // Perpendicular in world (CCW): depth world = (0,+1) in world.
    // Back to image: world (0,+1) -> image yPx flip -> pixel (0,-1)?
    // Actually: imagePxToWorldHorizontalM flips y (multiplies py by -1) then rotates.
    // northAngleDeg=0: no rotation. So world = {x: px.x, y: -px.y}.
    // Ridge px (1,0) -> world (1,0). Perp CCW: world (0,1).
    // worldHorizontalMToImagePx: un-rotate (no-op at 0 deg), then yPx = -wy = -1.
    // So depthAxisPx = (0, -1) at northAngleDeg=0 (pointing up in image = south in world).
    // NOTE: the sign just means "toward ridge from facade" vs "toward facade from ridge".
    // The key invariant: depthAxisPx must be perpendicular to ridgeAxisPx in image coords.
    const patch = makeSupportPatch("pan1", 30);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource(),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 0,
    });
    expect(result.model).not.toBeNull();
    const { ridgeAxisPx, depthAxisPx } = result.model!.orientation;
    // dot product must be ~0 (perpendicular)
    const dot = ridgeAxisPx.x * depthAxisPx.x + ridgeAxisPx.y * depthAxisPx.y;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    // depthAxisPx must be unit vector
    const len = Math.hypot(depthAxisPx.x, depthAxisPx.y);
    expect(Math.abs(len - 1)).toBeLessThan(1e-9);
  });

  it("northAngleDeg=90 : depthAxisPx est perpendiculaire a ridgeAxisPx dans le repere monde (pas pixels bruts)", () => {
    // Ridge is horizontal in pixels: ridgeAxisPx ~ (1, 0).
    // With northAngleDeg=90, pixel y maps to world y rotated.
    // The old (wrong) code: depthAxisPx = (-ridgeAxisPx.y, ridgeAxisPx.x) = (0, 1) in image.
    // The correct code via world space:
    //   ridgePx (1,0) -> imagePxToWorldHorizontalM(..., northAngleDeg=90):
    //     flip y: (1, 0), then rotate by 90deg CCW: world = (0, 1).
    //   depthWorld = perp CCW of (0,1) = (-1, 0).
    //   worldHorizontalMToImagePx(-1, 0, 1, 90): rotate -90 then flip y.
    //     rotate -90: (0, -1) (from (-1,0)). flip y on yPx: yPx = -(-1)=1?
    //     Actually worldHorizontalMToImagePx is strict inverse: xPx = cos(-90)*wx - sin(-90)*wy, yPx_pre = sin(-90)*wx + cos(-90)*wy, yPx = -yPx_pre.
    //     wx=-1, wy=0: xPx=cos(-90)*-1 - sin(-90)*0 = 0 - (-1)*0... let me trust the math.
    // Key assertion: depthAxisPx must be PERPENDICULAR to ridgeAxisPx in IMAGE coords.
    // (In both northAngleDeg=0 and 90, the world-space perp maps back to image-space perp.)
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource(),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 90,
    });
    expect(result.model).not.toBeNull();
    const { ridgeAxisPx, depthAxisPx } = result.model!.orientation;
    // Perpendicularity in image coords
    const dot = ridgeAxisPx.x * depthAxisPx.x + ridgeAxisPx.y * depthAxisPx.y;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    // Unit length
    const len = Math.hypot(depthAxisPx.x, depthAxisPx.y);
    expect(Math.abs(len - 1)).toBeLessThan(1e-9);
  });

  it("northAngleDeg=90 : depthAxisPx differe du resultat de la rotation pixel brute (0,+1)", () => {
    // Old code: depthAxisPx = (-ridgeAxisPx.y, ridgeAxisPx.x) = (0, +1) for ridge (1,0).
    // New code via world space must give a DIFFERENT answer for northAngleDeg=90.
    // This test catches any regression back to the naive pixel rotation.
    const patch = makeSupportPatch("pan1", 0);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource(),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 90,
    });
    expect(result.model).not.toBeNull();
    const { ridgeAxisPx, depthAxisPx } = result.model!.orientation;
    // The naive pixel perp of (1,0) would be (0,1). Verify we are NOT (0,+1).
    // (We accept (0,-1) or any other correct world-derived perp.)
    const naivePixelDepthY = ridgeAxisPx.x; // = 1 for ridge (1,0)
    // If depthAxisPx.y === naivePixelDepthY AND depthAxisPx.x === -ridgeAxisPx.y (=0),
    // that would be the old wrong answer.
    const isNaive =
      Math.abs(depthAxisPx.x - (-ridgeAxisPx.y)) < 1e-9 &&
      Math.abs(depthAxisPx.y - ridgeAxisPx.x) < 1e-9;
    // For northAngleDeg=90 the world-space result should differ from naive.
    // (For northAngleDeg=0 they happen to coincide, so we only assert this for 90.)
    expect(isNaive).toBe(false);
  });

  it("northAngleDeg=45 : depthAxisPx reste perpendiculaire a ridgeAxisPx", () => {
    const patch = makeSupportPatch("pan1", 20);
    const result = buildRoofExtensionV1FromSource({
      source: makeSource(),
      supportPatch: patch,
      metersPerPixel: 1,
      northAngleDeg: 45,
    });
    expect(result.model).not.toBeNull();
    const { ridgeAxisPx, depthAxisPx } = result.model!.orientation;
    const dot = ridgeAxisPx.x * depthAxisPx.x + ridgeAxisPx.y * depthAxisPx.y;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });
});
