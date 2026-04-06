import { describe, it, expect } from "vitest";
import {
  applySyntheticReliefToPremiumExport,
  capSyntheticConfidenceScore01,
  isSyntheticReliefConfidenceContext,
} from "../syntheticReliefConfidence.js";

describe("syntheticReliefConfidence", () => {
  it("RELIEF_ONLY et SYNTHETIC_STUB détectés", () => {
    expect(isSyntheticReliefConfidenceContext("RELIEF_ONLY", undefined)).toBe(true);
    expect(isSyntheticReliefConfidenceContext("SYNTHETIC_STUB", undefined)).toBe(true);
    expect(isSyntheticReliefConfidenceContext("IGN_RGE_ALTI", undefined)).toBe(false);
    expect(isSyntheticReliefConfidenceContext("HTTP_GEOTIFF", "SYNTHETIC")).toBe(true);
  });

  it("cap score 0–1", () => {
    expect(capSyntheticConfidenceScore01(0.85)).toBe(0.3);
    expect(capSyntheticConfidenceScore01(0.2)).toBe(0.2);
  });

  it("export premium : plafond + LOW", () => {
    const out = applySyntheticReliefToPremiumExport({
      source: "RELIEF_ONLY",
      far: { source: "RELIEF_ONLY", totalLossPct: 5 },
      shadingQuality: { score: 90, confidence: "HIGH", confidenceScore: 0.85 },
    });
    expect(out.confidence).toBe("LOW");
    expect(out.shadingQuality.confidence).toBe("LOW");
    expect(out.shadingQuality.confidenceScore).toBeLessThanOrEqual(0.3);
    expect(out.shadingQuality.note).toBe("synthetic_relief");
  });

  it("terrain réel : inchangé", () => {
    const input = {
      source: "IGN_RGE_ALTI",
      far: { source: "IGN_RGE_ALTI", totalLossPct: 5 },
      shadingQuality: { score: 0.85, confidence: "HIGH" },
    };
    const out = applySyntheticReliefToPremiumExport(input);
    expect(out).toBe(input);
    expect(out.shadingQuality.confidence).toBe("HIGH");
  });
});
