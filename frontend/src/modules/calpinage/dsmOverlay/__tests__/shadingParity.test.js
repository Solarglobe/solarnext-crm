/**
 * CP-FAR-C-09 — Front/Back shading parity: totalLossPct affiché = backend (diff < 0.2%).
 * Utilise getTotalLossPctFromShading (lecture backend: combined.totalLossPct).
 */

import { describe, it, expect } from "vitest";
import { getTotalLossPctFromShading } from "../buildShadingSummary.js";

const TOLERANCE_PCT = 0.2;
const BACKEND_PATH = "shading.combined.totalLossPct (or shading.totalLossPct)";
const FRONT_SELECTOR = "getTotalLossPctFromShading(shading)";

// 5 fixtures (forme backend V2: near, far, combined, shadingQuality)
const FIXTURES = [
  { name: "near=0, far>0", near: { totalLossPct: 0 }, far: { totalLossPct: 8.5 }, combined: { totalLossPct: 8.5 }, shadingQuality: { score: 0.9 } },
  { name: "near>0, far=0", near: { totalLossPct: 4.2 }, far: { totalLossPct: 0 }, combined: { totalLossPct: 4.2 }, shadingQuality: { score: 0.85 } },
  { name: "near+far rounding", near: { totalLossPct: 3.1 }, far: { totalLossPct: 5.9 }, combined: { totalLossPct: 9.0 }, shadingQuality: { score: 0.8 } },
  { name: "threshold 3.0 / 7.0 / 12.0", near: { totalLossPct: 2 }, far: { totalLossPct: 5 }, combined: { totalLossPct: 7.0 }, shadingQuality: { score: 0.75 } },
  { name: "LOW confidence partial coverage", near: { totalLossPct: 1.5 }, far: { totalLossPct: 10.2 }, combined: { totalLossPct: 11.7 }, shadingQuality: { score: 0.4 } },
];

describe("CP-FAR-C-09 shading parity (front = backend totalLossPct)", () => {
  let maxDiff = 0;

  for (const fixture of FIXTURES) {
    it(`[${fixture.name}] diff < ${TOLERANCE_PCT}%`, () => {
      const backendTotalLossPct = fixture.combined?.totalLossPct ?? fixture.totalLossPct;
      const frontTotalLossPct = getTotalLossPctFromShading(fixture);
      if (frontTotalLossPct == null || backendTotalLossPct == null) {
        throw new Error("unexpected null in numeric parity fixture");
      }
      const diff = Math.abs(frontTotalLossPct - backendTotalLossPct);
      if (diff > maxDiff) maxDiff = diff;

      if (diff > TOLERANCE_PCT) {
        const msg = [
          `[${fixture.name}] FAIL diff=${diff.toFixed(3)}%`,
          `  backend path: ${BACKEND_PATH} = ${backendTotalLossPct}`,
          `  front selector: ${FRONT_SELECTOR} = ${frontTotalLossPct}`,
          `  diff = ${diff.toFixed(3)}%`,
        ].join("\n");
        expect(diff, msg).toBeLessThanOrEqual(TOLERANCE_PCT);
      }
    });
  }

  it("CP-FAR-C-09 max diff reported", () => {
    expect(maxDiff).toBeLessThanOrEqual(TOLERANCE_PCT);
    if (process.env.CI !== "true") {
      console.log(`CP-FAR-C-09 PASS — max diff = ${maxDiff.toFixed(3)}%`);
    }
  });
});

describe("getTotalLossPctFromShading: backend shape (combined) preferred", () => {
  it("returns combined.totalLossPct when present", () => {
    const sh = { combined: { totalLossPct: 12.34 }, totalLossPct: 99 };
    expect(getTotalLossPctFromShading(sh)).toBe(12.34);
  });

  it("falls back to totalLossPct when combined absent", () => {
    const sh = { totalLossPct: 5.67 };
    expect(getTotalLossPctFromShading(sh)).toBe(5.67);
  });

  it("returns 0 for null shading root; null object = indisponible", () => {
    expect(getTotalLossPctFromShading(null)).toBe(0);
    expect(getTotalLossPctFromShading(undefined)).toBe(0);
    expect(getTotalLossPctFromShading({})).toBeNull();
  });

  it("returns null when missing_gps / UNAVAILABLE_NO_GPS même si combined présent", () => {
    expect(
      getTotalLossPctFromShading({
        combined: { totalLossPct: 5 },
        shadingQuality: { blockingReason: "missing_gps" },
      })
    ).toBeNull();
    expect(
      getTotalLossPctFromShading({
        combined: { totalLossPct: 5 },
        far: { source: "UNAVAILABLE_NO_GPS" },
      })
    ).toBeNull();
  });

  it("clamps to [0, 100]", () => {
    expect(getTotalLossPctFromShading({ combined: { totalLossPct: -1 } })).toBe(0);
    expect(getTotalLossPctFromShading({ combined: { totalLossPct: 150 } })).toBe(100);
  });
});
