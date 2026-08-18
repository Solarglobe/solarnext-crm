import { describe, expect, it } from "vitest";
import {
  clampViewerDpr,
  resolveInitialViewerQualityTier,
  resolveViewerQualityTransition,
  VIEWER_QUALITY_PROFILES,
  type ViewerFrameWindowStats,
} from "../viewerQualityProfile";

function stats(overrides: Partial<ViewerFrameWindowStats>): ViewerFrameWindowStats {
  return {
    fpsAvg: 60,
    fpsLow: 55,
    frameTimeAvgMs: 16.6,
    frameTimeP95Ms: 18,
    frameCount: 180,
    durationMs: 5000,
    ...overrides,
  };
}

describe("viewerQualityProfile", () => {
  it("initial tier : machine puissante desktop -> HIGH", () => {
    expect(resolveInitialViewerQualityTier({
      viewportWidth: 1920,
      viewportHeight: 1080,
      devicePixelRatio: 1,
      hardwareConcurrency: 12,
      deviceMemoryGb: 16,
      isMobileLike: false,
    })).toBe("HIGH");
  });

  it("initial tier : tablette ou forte densite pixels -> LOW prudent", () => {
    expect(resolveInitialViewerQualityTier({
      viewportWidth: 2560,
      viewportHeight: 1440,
      devicePixelRatio: 2,
      hardwareConcurrency: 4,
      deviceMemoryGb: 4,
      isMobileLike: false,
    })).toBe("LOW");
    expect(resolveInitialViewerQualityTier({
      viewportWidth: 1180,
      viewportHeight: 820,
      devicePixelRatio: 2,
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      isMobileLike: true,
    })).toBe("LOW");
  });

  it("baisse de qualite : HIGH -> MEDIUM puis MEDIUM -> LOW si la mesure reste mauvaise", () => {
    const first = resolveViewerQualityTransition({
      mode: "AUTO",
      currentTier: "HIGH",
      stats: stats({ fpsAvg: 35, fpsLow: 24, frameTimeP95Ms: 38 }),
      nowMs: 5000,
      lastTierChangeAtMs: 0,
    });
    expect(first.tier).toBe("MEDIUM");

    const second = resolveViewerQualityTransition({
      mode: "AUTO",
      currentTier: "MEDIUM",
      stats: stats({ fpsAvg: 24, fpsLow: 18, frameTimeP95Ms: 52 }),
      nowMs: 6500,
      lastTierChangeAtMs: 5000,
    });
    expect(second.tier).toBe("LOW");
  });

  it("hysteresis : quelques bonnes frames ou cooldown ne remontent pas tout de suite", () => {
    expect(resolveViewerQualityTransition({
      mode: "AUTO",
      currentTier: "LOW",
      stats: stats({ frameCount: 10, durationMs: 450 }),
      nowMs: 1000,
      lastTierChangeAtMs: 0,
    }).tier).toBe("LOW");

    expect(resolveViewerQualityTransition({
      mode: "AUTO",
      currentTier: "LOW",
      stats: stats({ fpsAvg: 60, fpsLow: 56, frameTimeP95Ms: 18 }),
      nowMs: 8000,
      lastTierChangeAtMs: 0,
    }).tier).toBe("LOW");
  });

  it("remontee : performance durablement bonne -> LOW -> MEDIUM puis MEDIUM -> HIGH", () => {
    expect(resolveViewerQualityTransition({
      mode: "AUTO",
      currentTier: "LOW",
      stats: stats({ fpsAvg: 60, fpsLow: 55, frameTimeP95Ms: 18 }),
      nowMs: 20000,
      lastTierChangeAtMs: 0,
    }).tier).toBe("MEDIUM");

    expect(resolveViewerQualityTransition({
      mode: "AUTO",
      currentTier: "MEDIUM",
      stats: stats({ fpsAvg: 60, fpsLow: 55, frameTimeP95Ms: 18 }),
      nowMs: 40000,
      lastTierChangeAtMs: 20000,
    }).tier).toBe("HIGH");
  });

  it("mode manuel : AUTO ne modifie jamais un tier force", () => {
    expect(resolveViewerQualityTransition({
      mode: "HIGH",
      currentTier: "LOW",
      stats: stats({ fpsAvg: 12, fpsLow: 9, frameTimeP95Ms: 90 }),
      nowMs: 20000,
      lastTierChangeAtMs: 0,
    }).tier).toBe("HIGH");
  });

  it("fallback APIs absentes : DPR borne et profils coherents", () => {
    expect(clampViewerDpr(3, VIEWER_QUALITY_PROFILES.MEDIUM)).toBe(1.35);
    expect(clampViewerDpr(Number.NaN, VIEWER_QUALITY_PROFILES.LOW)).toBe(1);
    expect(VIEWER_QUALITY_PROFILES.HIGH.postprocessing).toBe(true);
    expect(VIEWER_QUALITY_PROFILES.LOW.postprocessing).toBe(false);
  });
});
