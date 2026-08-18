import { describe, expect, it } from "vitest";
import type { SolarScene3D } from "../../types/solarScene3d";
import { exposeViewerDebugFacade } from "../viewerDebugFacade";
import type { ViewerReliabilityState } from "../viewerReliabilityState";

const reliability: ViewerReliabilityState = {
  kind: "ready",
  generation: 3,
  renderedGeneration: 3,
  source: "OFFICIAL",
  geometryTruthStatus: "VALID",
  officialBuildStatus: "SUCCESS",
  officialBuildError: null,
  fallbackAttempted: false,
  fallbackSucceeded: false,
  stale: false,
  invalidPatchCount: 0,
  degradedPatchCount: 0,
  lastKnownGoodGeneration: 3,
  issueCodes: [],
  userMessage: null,
  technicalDetails: [],
  diagnostics: [],
};

function makeScene(): SolarScene3D {
  return {
    metadata: {
      schemaVersion: "solar-scene-3d-v1",
      createdAtIso: "2026-08-18T00:00:00.000Z",
      generator: "manual",
      roofGeometrySource: "REAL_ROOF_PANS",
      geometryTruthStatus: "VALID",
      pvPlacementValidityStatus: "VALID",
    },
    roofModel: {
      schemaVersion: "roof-model-3d-v1",
      coordinateSystem: "WORLD_ENU_Z_UP",
      units: { length: "m", angle: "deg" },
      vertices: [],
      roofPlanePatches: [
        {
          id: "pan-a",
          topologyRole: "primary_shell",
          boundaryVertexIds: ["a", "b", "c"],
          boundaryEdgeIds: ["ab", "bc", "ca"],
          cornersWorld: [
            { x: 0, y: 0, z: 4 },
            { x: 4, y: 0, z: 4 },
            { x: 0, y: 3, z: 5 },
          ],
          localFrame: {
            origin: { x: 0, y: 0, z: 4 },
            xAxis: { x: 1, y: 0, z: 0 },
            yAxis: { x: 0, y: 1, z: 0 },
            zAxis: { x: 0, y: 0, z: 1 },
          },
          normal: { x: 0, y: 0, z: 1 },
          equation: { normal: { x: 0, y: 0, z: 1 }, d: -4 },
          boundaryCycleWinding: "counter_clockwise",
          tiltDeg: 12,
          azimuthDeg: 180,
          centroid: { x: 1.3, y: 1, z: 4.3 },
          surface: { areaM2: 6, projectedAreaM2: 5.9 },
          adjacentPlanePatchIds: [],
          provenance: { source: "manual", sourceIds: [] },
          quality: { status: "VALID", diagnostics: [] },
        },
      ],
      roofEdges: [],
      roofRidges: [],
      topologyGraph: { nodes: [], edges: [] },
      quality: { status: "VALID", diagnostics: [] },
    },
    obstacleVolumes: [],
    extensionVolumes: [],
    pvPanels: [
      {
        id: "pv-a",
        roofPlanePatchId: "pan-a",
      },
    ],
    volumesQuality: { status: "VALID", diagnostics: [] },
  } as unknown as SolarScene3D;
}

describe("viewer debug facade", () => {
  it("exposes read-only scene, reliability, quality and selection diagnostics without replacing the debug flag", () => {
    (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_DEBUG__"] = true;

    exposeViewerDebugFacade({
      scene: makeScene(),
      reliability,
      qualityMode: "AUTO",
      effectiveQualityTier: "HIGH",
      selectedHit: { kind: "PAN", id: "pan-a" },
      inspectionSelection: null,
      pvLayoutSelectedCount: 1,
    });

    const target = window as unknown as Record<string, { snapshot?: () => unknown } | unknown>;
    expect(target["__CALPINAGE_3D_DEBUG__"]).toBe(true);
    const api = target["__CALPINAGE_3D_DEBUG_API__"] as { snapshot: () => any };
    const snapshot = api.snapshot();
    expect(snapshot.geometry.patchCount).toBe(1);
    expect(snapshot.geometry.patches[0].id).toBe("pan-a");
    expect(snapshot.geometry.patches[0].pvPanelIds).toEqual(["pv-a"]);
    expect(snapshot.reliability.kind).toBe("ready");
    expect(snapshot.quality.effectiveTier).toBe("HIGH");
    expect(snapshot.selection.pvLayoutSelectedCount).toBe(1);
  });
});
