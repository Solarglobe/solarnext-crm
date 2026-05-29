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
          kind: "dormer",
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

  it("relit un modele canonicalV1 persiste quand les champs legacy libres sont absents", () => {
    const patch = makeSupportPatch("pan-persisted-v1", 0);
    const res = buildRoofExtensions3DFromRuntime({
      runtime: {
        roofExtensions: [{
          id: "rx-persisted",
          type: "roof_extension",
          canonicalV1: {
            version: "roof_extension_v1",
            id: "rx-persisted",
            kind: "dormer",
            supportPanId: "pan-persisted-v1",
            footprintPx: [
              { x: 1, y: 1, heightRelM: 0 },
              { x: 4, y: 1, heightRelM: 0 },
              { x: 4, y: 4, heightRelM: 0 },
              { x: 1, y: 4, heightRelM: 0 },
            ],
            footprintWinding: "counter_clockwise",
            ridgePx: {
              a: { x: 2.5, y: 1.5, heightRelM: 1.1 },
              b: { x: 2.5, y: 3.5, heightRelM: 1.1 },
            },
            hipsPx: null,
            apexId: null,
            apexPx: null,
            dimensions: {
              widthM: 0.2,
              depthM: 0.3,
              footprintAreaM2: 0.09,
              wallHeightM: 0.35,
              roofHeightM: 0.75,
              totalHeightM: 1.1,
            },
            orientation: {
              ridgeAxisPx: { x: 0, y: 1 },
              depthAxisPx: { x: -1, y: 0 },
              ridgeAngleDeg: 90,
            },
            roof: {
              topologyType: "gable_dormer",
              pitchDeg: 35,
              eaveOffsetM: 0.04,
              seamOffsetM: 0.02,
            },
            render: {
              materialFamily: "roof_extension_premium",
              showDebugLines: false,
              selectable: true,
            },
            pv: {
              keepoutSource: "footprint",
              keepoutOffsetM: 0.08,
              shadowSource: "canonical_mesh",
              raycastSource: "canonical_mesh",
            },
            provenance: {
              source: "legacy_runtime_roof_extension",
              sourceIndex: 0,
              inferredSupportPanId: false,
              ignoredLegacyFields: ["stage"],
            },
          },
        }],
      },
      roofPlanePatches: [patch],
      ...WORLD,
    });

    expect(res.extensionVolumes).toHaveLength(1);
    expect(res.extensionVolumes[0]!.relatedPlanePatchIds).toContain("pan-persisted-v1");
    expect(res.extensionVolumes[0]!.topology?.canonicalDimensions?.totalHeightM).toBe(1.1);
    expect(res.quality.diagnostics.some((d) => d.code === "ROOF_EXTENSION_SOURCE_FROM_CANONICAL_V1")).toBe(true);
    expect(res.quality.diagnostics.some((d) => d.code === "ROOF_EXTENSION_V1_VALID")).toBe(true);
  });

  it("utilise canonicalV1 comme source prioritaire quand les champs legacy divergent", () => {
    const patch = makeSupportPatch("pan-canonical-source", 0);
    const res = buildRoofExtensions3DFromRuntime({
      runtime: {
        roofExtensions: [{
          id: "rx-stale-legacy",
          kind: "shed",
          supportPanId: "pan-stale-legacy",
          contour: {
            closed: true,
            points: [
              { x: 100, y: 100 },
              { x: 105, y: 100 },
              { x: 105, y: 105 },
              { x: 100, y: 105 },
            ],
          },
          ridge: {
            a: { x: 101, y: 101, h: 9.9 },
            b: { x: 104, y: 104, h: 9.9 },
          },
          ridgeHeightRelM: 9.9,
          wallHeightM: 5,
          canonicalV1: {
            version: "roof_extension_v1",
            id: "rx-stale-legacy",
            kind: "dormer",
            supportPanId: "pan-canonical-source",
            footprintPx: [
              { x: 1, y: 1, heightRelM: 0 },
              { x: 4, y: 1, heightRelM: 0 },
              { x: 4, y: 4, heightRelM: 0 },
              { x: 1, y: 4, heightRelM: 0 },
            ],
            footprintWinding: "counter_clockwise",
            ridgePx: {
              a: { x: 2.5, y: 1.5, heightRelM: 1.25 },
              b: { x: 2.5, y: 3.5, heightRelM: 1.25 },
            },
            hipsPx: null,
            apexId: null,
            apexPx: null,
            dimensions: {
              widthM: 0.2,
              depthM: 0.3,
              footprintAreaM2: 0.09,
              wallHeightM: 0.4,
              roofHeightM: 0.85,
              totalHeightM: 1.25,
            },
            orientation: {
              ridgeAxisPx: { x: 0, y: 1 },
              depthAxisPx: { x: -1, y: 0 },
              ridgeAngleDeg: 90,
            },
            roof: {
              topologyType: "gable_dormer",
              pitchDeg: 35,
              eaveOffsetM: 0.04,
              seamOffsetM: 0.02,
            },
            render: {
              materialFamily: "roof_extension_premium",
              showDebugLines: false,
              selectable: true,
            },
            pv: {
              keepoutSource: "footprint",
              keepoutOffsetM: 0.08,
              shadowSource: "canonical_mesh",
              raycastSource: "canonical_mesh",
            },
            provenance: {
              source: "legacy_runtime_roof_extension",
              sourceIndex: 0,
              inferredSupportPanId: false,
              ignoredLegacyFields: ["contour", "ridge", "supportPanId"],
            },
          },
        }],
      },
      roofPlanePatches: [patch],
      ...WORLD,
    });

    expect(res.extensionVolumes).toHaveLength(1);
    expect(res.extensionVolumes[0]!.kind).toBe("dormer");
    expect(res.extensionVolumes[0]!.relatedPlanePatchIds).toContain("pan-canonical-source");
    expect(res.extensionVolumes[0]!.topology?.canonicalDimensions?.totalHeightM).toBe(1.25);
    expect(res.extensionVolumes[0]!.topology?.canonicalDimensions?.wallHeightM).toBe(0.4);
    expect(res.quality.diagnostics.some((d) => d.code === "ROOF_EXTENSION_V1_VALID")).toBe(true);
  });
});
