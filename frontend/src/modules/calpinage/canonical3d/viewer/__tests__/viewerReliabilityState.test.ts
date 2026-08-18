import { describe, expect, it } from "vitest";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import { createEmptyRoofModel3D } from "../../utils/factories";
import {
  normalizeViewerOfficialBuildError,
  resolveViewerReliabilityState,
} from "../viewerReliabilityState";
import type { SolarScene3D } from "../../types/solarScene3d";

function sceneWithTruth(status: "VALID" | "DEGRADED" | "INVALID"): SolarScene3D {
  const patch = makeHorizontalSquarePatch("roof-h", 10, 8);
  const base = buildSolarScene3D({
    roofModel: { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] },
    obstacleVolumes: [],
    extensionVolumes: [],
    volumesQuality: createEmptyRoofModel3D().globalQuality,
    pvPanels: [],
  });
  return {
    ...base,
    metadata: {
      ...base.metadata,
      geometryTruthStatus: status,
      geometryTruthInvalidPatchCount: status === "INVALID" ? 1 : 0,
      geometryTruthDegradedPatchCount: status === "DEGRADED" ? 1 : 0,
    },
  };
}

describe("viewerReliabilityState", () => {
  it("A — scene officielle valide : source OFFICIAL, ready, aucun warning", () => {
    const state = resolveViewerReliabilityState({
      scene: sceneWithTruth("VALID"),
      source: "OFFICIAL",
      generation: 12,
      renderedGeneration: 12,
      officialBuildStatus: "SUCCESS",
    });
    expect(state.kind).toBe("ready");
    expect(state.source).toBe("OFFICIAL");
    expect(state.geometryTruthStatus).toBe("VALID");
    expect(state.userMessage).toBeNull();
    expect(state.issueCodes).toHaveLength(0);
  });

  it("B — scene officielle DEGRADED : warning visible et details accessibles", () => {
    const state = resolveViewerReliabilityState({
      scene: sceneWithTruth("DEGRADED"),
      source: "OFFICIAL",
      generation: 13,
      renderedGeneration: 13,
      officialBuildStatus: "SUCCESS",
    });
    expect(state.kind).toBe("degraded");
    expect(state.issueCodes).toContain("DEGRADED_GEOMETRY");
    expect(state.userMessage).toMatch(/partiellement/i);
  });

  it("C — scene officielle INVALID : ne devient jamais ready", () => {
    const state = resolveViewerReliabilityState({
      scene: sceneWithTruth("INVALID"),
      source: "OFFICIAL",
      generation: 14,
      renderedGeneration: 14,
      officialBuildStatus: "SUCCESS",
    });
    expect(state.kind).toBe("invalid");
    expect(state.issueCodes).toContain("GEOMETRY_INVALID");
  });

  it("D — official echoue et fallback reussit : fallback explicite et erreur conservee", () => {
    const officialError = normalizeViewerOfficialBuildError(new Error("roof truth failed"));
    const state = resolveViewerReliabilityState({
      scene: sceneWithTruth("VALID"),
      source: "EMERGENCY_FALLBACK",
      generation: 15,
      renderedGeneration: 15,
      officialBuildStatus: "FAILED",
      officialBuildError: officialError,
      fallbackAttempted: true,
      fallbackSucceeded: true,
    });
    expect(state.kind).toBe("fallback");
    expect(state.source).toBe("EMERGENCY_FALLBACK");
    expect(state.officialBuildError?.message).toBe("roof truth failed");
    expect(state.issueCodes).toContain("OFFICIAL_BUILD_FAILED");
  });

  it("E — official et fallback echouent : etat error visible", () => {
    const state = resolveViewerReliabilityState({
      scene: null,
      source: "UNAVAILABLE",
      generation: 16,
      officialBuildStatus: "FAILED",
      officialBuildError: normalizeViewerOfficialBuildError("nothing buildable"),
      fallbackAttempted: true,
      fallbackSucceeded: false,
    });
    expect(state.kind).toBe("error");
    expect(state.userMessage).toMatch(/pas pu/i);
    expect(state.issueCodes).toContain("UNAVAILABLE");
  });

  it("G — last known good stale : ancienne scene marquee non synchronisee", () => {
    const state = resolveViewerReliabilityState({
      scene: sceneWithTruth("VALID"),
      source: "OFFICIAL",
      generation: 42,
      renderedGeneration: 41,
      officialBuildStatus: "SUCCESS",
      lastKnownGoodGeneration: 41,
    });
    expect(state.kind).toBe("stale");
    expect(state.stale).toBe(true);
    expect(state.issueCodes).toContain("STALE_SCENE");
  });

  it("H — fallback sans erreur officielle est refuse par invariant", () => {
    expect(() =>
      resolveViewerReliabilityState({
        scene: sceneWithTruth("VALID"),
        source: "EMERGENCY_FALLBACK",
        generation: 43,
        renderedGeneration: 43,
        officialBuildStatus: "FAILED",
        fallbackAttempted: true,
        fallbackSucceeded: true,
      }),
    ).toThrow(/Official failure/);
  });
});
