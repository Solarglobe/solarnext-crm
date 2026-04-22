import { describe, expect, it } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntimeCore";
import { minimalCalpinageRuntimeFixture } from "../../dev/minimalCalpinageRuntimeFixture";
import { deriveCanonicalPans3DFromRoofPlanePatches } from "../deriveCanonicalPans3DFromRoofPlanePatches";

describe("deriveCanonicalPans3DFromRoofPlanePatches", () => {
  it("produit un pan par patch RoofTruth, géométrie cohérente avec le build officiel", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(res.ok).toBe(true);
    expect(res.officialRoofModelResult).toBeDefined();
    const patches = res.officialRoofModelResult!.model.roofPlanePatches;
    const roof = minimalCalpinageRuntimeFixture.roof as {
      scale: { metersPerPixel: number };
      roof: { north: { angleDeg: number } };
    };
    const derived = deriveCanonicalPans3DFromRoofPlanePatches({
      roofPlanePatches: patches,
      metersPerPixel: roof.scale.metersPerPixel,
      northAngleDeg: roof.roof.north.angleDeg,
    });
    expect(derived.length).toBe(patches.length);
    for (const p of derived) {
      expect(p.diagnostics.zSourceSummary).toContain("roof_truth_plane_patch");
      expect(p.vertices3D.length).toBeGreaterThanOrEqual(3);
      expect(p.diagnostics.isDegenerate).toBe(false);
    }
  });
});
