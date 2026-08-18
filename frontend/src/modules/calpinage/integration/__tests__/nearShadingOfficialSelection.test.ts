import { afterEach, describe, expect, it, vi } from "vitest";
import { attemptCanonicalNearShading, mergeOfficialNearShading } from "../nearShadingOfficialSelection";
import {
  __resetCanonicalNearShadingFlagWarningForTests,
  getCanonicalNearShadingFlagResolution,
} from "../canonicalNearShadingFlags";
import type { ComputeNearShadingFrontendResult } from "../../shading/nearShadingTypes";
import type { PanelInput } from "../../shading/shadingInputTypes";

const panels: PanelInput[] = [
  { id: "a", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
];

function legacyBase(over: Partial<ComputeNearShadingFrontendResult> = {}): Omit<
  ComputeNearShadingFrontendResult,
  "officialNear"
> {
  return {
    totalLossPct: 12,
    perPanel: [
      {
        panelId: "a",
        shadedFractionAvg: 0.1,
        lossPct: 12,
      },
    ],
    ...over,
  };
}

describe("mergeOfficialNearShading", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetCanonicalNearShadingFlagWarningForTests();
  });

  it("canonical success → engine CANONICAL_3D, totalLossPct = canonical", () => {
    const out = mergeOfficialNearShading(
      legacyBase({ totalLossPct: 5 }),
      {
        type: "success",
        nearLossPct: 8.5,
        meanShadedFraction: 0.085,
        diagnostics: ["roofPatches=1"],
        perPanelCanonical: [{ panelId: "a", meanShadedFraction: 0.085, lossPct: 8.5 }],
      },
      panels
    );
    expect(out.officialNear.engine).toBe("CANONICAL_3D");
    expect(out.officialNear.fallbackTriggered).toBe(false);
    expect(out.officialNear.canonicalUsable).toBe(true);
    expect(out.officialNear.legacyReferenceLossPct).toBe(5);
    expect(out.officialNear.officialLossPct).toBe(8.5);
    expect(out.totalLossPct).toBe(8.5);
    expect(out.canonicalNear?.nearEngineMode).toBe("CANONICAL_3D");
  });

  it("canonical skipped → NONE officiel, pas de fallback legacy silencieux", () => {
    const out = mergeOfficialNearShading(
      legacyBase(),
      {
        type: "skipped",
        reasonCode: "NO_ROOF_STATE",
        diagnostics: ["no roof"],
      },
      panels
    );
    expect(out.officialNear.engine).toBe("NONE");
    expect(out.officialNear.fallbackTriggered).toBe(false);
    expect(out.officialNear.canonicalRejectedBecause).toBe("NO_ROOF_STATE");
    expect(out.officialNear.legacyReferenceLossPct).toBe(12);
    expect(out.totalLossPct).toBeNull();
    expect(out.unavailable?.reason).toBe("NO_ROOF_STATE");
    expect(out.canonicalNear?.nearEngineMode).toBe("NONE");
  });

  it("flag off (not_attempted) → legacy, pas de fallback", () => {
    const out = mergeOfficialNearShading(
      legacyBase(),
      { type: "not_attempted", reason: "CANONICAL_NEAR_FLAG_OFF" },
      panels
    );
    expect(out.officialNear.engine).toBe("LEGACY_POLYGON");
    expect(out.officialNear.fallbackTriggered).toBe(false);
    expect(out.canonicalNear).toBeUndefined();
  });

  it("parse strictement VITE_CANONICAL_3D_NEAR_SHADING", () => {
    vi.stubEnv("VITE_CANONICAL_3D_NEAR_SHADING", "true");
    expect(getCanonicalNearShadingFlagResolution().state).toBe("ENABLED");

    vi.stubEnv("VITE_CANONICAL_3D_NEAR_SHADING", "false");
    expect(getCanonicalNearShadingFlagResolution().state).toBe("DISABLED");

    vi.stubEnv("VITE_CANONICAL_3D_NEAR_SHADING", "1");
    const bad = getCanonicalNearShadingFlagResolution();
    expect(bad.state).toBe("MISCONFIGURED");
    expect(bad.diagnosticCode).toBe("FEATURE_FLAG_INVALID_BOOLEAN");
  });

  it("flag mal configuré → NONE, diagnostic explicite, pas de fallback officiel", () => {
    vi.stubEnv("VITE_CANONICAL_3D_NEAR_SHADING", "yes");
    const attempt = attemptCanonicalNearShading({
      panels,
      obstacles: [],
      latitude: 48,
      longitude: 2,
    });
    expect(attempt.type).toBe("skipped");
    if (attempt.type !== "skipped") throw new Error("attempt should be skipped");
    expect(attempt.reasonCode).toBe("CANONICAL_NEAR_FLAG_MISCONFIGURED");
    const out = mergeOfficialNearShading(legacyBase(), attempt, panels);
    expect(out.officialNear.engine).toBe("NONE");
    expect(out.officialNear.officialLossPct).toBeNull();
    expect(out.officialNear.legacyReferenceLossPct).toBe(12);
  });
});
