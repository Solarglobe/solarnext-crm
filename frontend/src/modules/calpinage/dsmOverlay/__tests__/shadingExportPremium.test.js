/**
 * CP-FAR-C-10 — Export shading PREMIUM : structure traçable et validations.
 */

import { describe, it, expect } from "vitest";
import { buildPremiumShadingExport, VALID_CONFIDENCE, VALID_SOURCE } from "../../export/buildShadingExport.js";

function isValidIsoDateString(str) {
  if (typeof str !== "string") return false;
  const d = new Date(str);
  return !Number.isNaN(d.getTime());
}

describe("CP-FAR-C-10 shading export premium", () => {
  const normalized = {
    near: { totalLossPct: 3.5 },
    far: { totalLossPct: 8.2, source: "IGN_RGE_ALTI", confidenceLevel: "HIGH" },
    combined: { totalLossPct: 11.7 },
    shadingQuality: { score: 85, grade: "A", confidence: "HIGH" },
    perPanel: [],
    computedAt: Date.now(),
  };

  const json = { shading: buildPremiumShadingExport(normalized) };

  it("1) json.shading.near exists", () => {
    expect(json.shading).toBeDefined();
    expect(json.shading.near).toBeDefined();
    expect(json.shading.near).not.toBeNull();
  });

  it("2) json.shading.far exists", () => {
    expect(json.shading.far).toBeDefined();
    expect(json.shading.far).not.toBeNull();
  });

  it("3) json.shading.combined.totalLossPct is number", () => {
    expect(json.shading.combined).toBeDefined();
    expect(typeof json.shading.combined.totalLossPct).toBe("number");
    expect(Number.isNaN(json.shading.combined.totalLossPct)).toBe(false);
  });

  it("4) json.shading.source is valid string", () => {
    expect(typeof json.shading.source).toBe("string");
    expect(json.shading.source.length).toBeGreaterThan(0);
  });

  it("5) json.shading.confidence in [HIGH, MEDIUM, LOW, UNKNOWN]", () => {
    expect(VALID_CONFIDENCE).toContain(json.shading.confidence);
  });

  it("6) json.shading.computedAt is valid ISO date string", () => {
    expect(typeof json.shading.computedAt).toBe("string");
    expect(isValidIsoDateString(json.shading.computedAt)).toBe(true);
  });

  it("7) no root totalLossPct on export result", () => {
    expect(json.totalLossPct).toBeUndefined();
  });
});

describe("buildPremiumShadingExport null / legacy fallback", () => {
  it("returns null when normalized is null", () => {
    expect(buildPremiumShadingExport(null)).toBeNull();
    expect(buildPremiumShadingExport(undefined)).toBeNull();
  });

  it("builds minimal blocks from legacy flat normalized", () => {
    const legacy = {
      totalLossPct: 5.5,
      nearLossPct: 2,
      farLossPct: 3.5,
      farSource: "RELIEF_ONLY",
    };
    const out = buildPremiumShadingExport(legacy);
    expect(out).not.toBeNull();
    expect(out.near.totalLossPct).toBe(2);
    expect(out.far.totalLossPct).toBe(3.5);
    expect(out.far.source).toBe("RELIEF_ONLY");
    expect(out.combined.totalLossPct).toBe(5.5);
    expect(out.confidence).toBe("LOW");
    expect(out.source).toBe("RELIEF_ONLY");
    expect(out.shadingQuality?.confidence).toBe("LOW");
    expect(out.shadingQuality?.confidenceScore).toBeLessThanOrEqual(0.3);
    expect(out.shadingQuality?.note).toBe("synthetic_relief");
    expect(isValidIsoDateString(out.computedAt)).toBe(true);
  });

  it("UNAVAILABLE_NO_GPS : farHorizonKind UNAVAILABLE, far.totalLossPct null", () => {
    const n = {
      near: { totalLossPct: null },
      far: { totalLossPct: null, source: "UNAVAILABLE_NO_GPS", farHorizonKind: "UNAVAILABLE" },
      combined: { totalLossPct: null },
      shadingQuality: { blockingReason: "missing_gps", confidence: "LOW" },
    };
    const out = buildPremiumShadingExport(n);
    expect(out).not.toBeNull();
    expect(out.farHorizonKind).toBe("UNAVAILABLE");
    expect(out.far.source).toBe("UNAVAILABLE_NO_GPS");
    expect(out.far.totalLossPct).toBeNull();
    expect(out.shadingQuality?.blockingReason).toBe("missing_gps");
  });

  it("legacy flat : combined.totalLossPct null reste null (pas de faux 0 %)", () => {
    const legacy = {
      totalLossPct: null,
      nearLossPct: 2,
      farLossPct: null,
      farSource: "UNAVAILABLE_NO_GPS",
      shadingQuality: { blockingReason: "missing_gps" },
    };
    const out = buildPremiumShadingExport(legacy);
    expect(out).not.toBeNull();
    expect(out.combined.totalLossPct).toBeNull();
    expect(out.totalLossPct).toBeNull();
    expect(out.far.totalLossPct).toBeNull();
  });
});
