import { describe, expect, it } from "vitest";
import { buildRoofExtensions3DFromRuntime } from "../buildRoofExtensions3DFromRuntime";
import { WORLD_FIXTURE as WORLD, makeSupportPatch } from "./roofExtensionVolumeTestUtils";

describe("RoofExtensionV1 canonical model", () => {
  it("insere un modele canonique strict entre le legacy runtime et le volume 3D", () => {
    const patch = makeSupportPatch("pan-v1", 0);
    const res = buildRoofExtensions3DFromRuntime({
      runtime: {
        roofExtensions: [{
          id: "rx-v1",
          kind: "chien_assis",
          supportPanId: "pan-v1",
          contour: {
            closed: true,
            points: [
              { x: 1, y: 1 },
              { x: 4, y: 1 },
              { x: 4, y: 4 },
              { x: 1, y: 4 },
            ],
          },
          ridge: {
            a: { x: 2.5, y: 1.5, h: 1.2 },
            b: { x: 2.5, y: 3.5, h: 1.2 },
          },
          ridgeHeightRelM: 1.2,
          wallHeightM: 0.4,
          canonicalDormerGeometry: { vertices: [{ id: "dead", x: 99, y: 99, h: 0 }] },
        }],
      },
      roofPlanePatches: [patch],
      ...WORLD,
    });

    expect(res.extensionVolumes).toHaveLength(1);
    const topology = res.extensionVolumes[0]!.topology!;
    expect(topology.canonicalModelVersion).toBe("roof_extension_v1");
    expect(topology.canonicalTopologyType).toBe("gable_dormer");
    expect(topology.canonicalDimensions?.wallHeightM).toBe(0.4);
    expect(topology.ignoredLegacyCanonicalDormerGeometry).toBe(true);
    expect(res.quality.diagnostics.some((d) => d.code === "LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED")).toBe(true);
    expect(res.quality.diagnostics.some((d) => d.code === "ROOF_EXTENSION_V1_VALID")).toBe(true);
  });

  it("bloque un footprint auto-intersectant au lieu de produire un mesh faux", () => {
    const patch = makeSupportPatch("pan-invalid", 0);
    const res = buildRoofExtensions3DFromRuntime({
      runtime: {
        roofExtensions: [{
          id: "rx-bowtie",
          kind: "dormer",
          supportPanId: "pan-invalid",
          contour: {
            closed: true,
            points: [
              { x: 1, y: 1 },
              { x: 4, y: 4 },
              { x: 4, y: 1 },
              { x: 1, y: 4 },
            ],
          },
          ridge: {
            a: { x: 2.5, y: 1.5, h: 1 },
            b: { x: 2.5, y: 3.5, h: 1 },
          },
          ridgeHeightRelM: 1,
        }],
      },
      roofPlanePatches: [patch],
      ...WORLD,
    });

    expect(res.extensionVolumes).toHaveLength(0);
    expect(res.quality.diagnostics.some((d) => d.code === "ROOF_EXTENSION_V1_FOOTPRINT_SELF_INTERSECTION")).toBe(true);
    expect(res.quality.diagnostics.some((d) => d.code === "ROOF_EXTENSION_V1_BUILD_BLOCKED")).toBe(true);
  });
});
