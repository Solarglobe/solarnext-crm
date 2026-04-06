/**
 * Hook runtime → SolarScene3D (assemblage + validation).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "../dev/minimalCalpinageRuntimeFixture";

describe("buildSolarScene3DFromCalpinageRuntime", () => {
  afterEach(() => {
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
    vi.restoreAllMocks();
  });

  it("runtime minimal valide → ok, scene SolarScene3D non nulle", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);

    expect(res.ok).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(res.scene!.roofModel.roofPlanePatches.length).toBeGreaterThan(0);
    expect(res.scene!.metadata.integrationNotes).toContain("calpinage-runtime");
    expect(res.scene!.worldConfig).toEqual({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
    });
    expect(res.diagnostics.errors.length).toBe(0);
    expect(res.coherence).not.toBeNull();
    expect(res.coherence?.isCoherent).toBe(true);
    expect(res.scene?.coherence).toEqual(res.coherence);
    expect(res.scene?.sourceTrace?.sourcePanIds.length).toBeGreaterThan(0);
    expect(res.scene?.sourceTrace?.expectedRoofPlanePatchIds?.length).toBeGreaterThan(0);
  });

  it("avec getHeightAtXY mocké — scène se construit, patches cohérents, Z sommets suit le mock (chemin riche)", () => {
    (window as unknown as { getHeightAtXY: (pid: string, x: number, y: number) => number }).getHeightAtXY =
      vi.fn().mockReturnValue(6.25);

    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);

    expect(res.ok).toBe(true);
    expect(res.scene).not.toBeNull();
    const patches = res.scene!.roofModel.roofPlanePatches;
    expect(patches.length).toBeGreaterThan(0);
    const zVals = patches[0]!.cornersWorld.map((c) => c.z);
    for (const z of zVals) {
      expect(z).toBeCloseTo(0, 5);
    }
  });

  it("runtime sans contrat monde explicite → ok false, is3DEligible false (pas de pseudo-3D)", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [],
      },
    });
    expect(res.ok).toBe(false);
    expect(res.is3DEligible).toBe(false);
    expect(res.scene).toBeNull();
    expect(res.coherence).toBeNull();
  });
});
