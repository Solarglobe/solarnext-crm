import { describe, expect, it } from "vitest";
import { mergeOfficialNearShading } from "../nearShadingOfficialSelection";
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
  it("canonical success → engine canonical_3d, totalLossPct = canonical", () => {
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
    expect(out.officialNear.engine).toBe("canonical_3d");
    expect(out.officialNear.fallbackTriggered).toBe(false);
    expect(out.officialNear.canonicalUsable).toBe(true);
    expect(out.officialNear.legacyReferenceLossPct).toBe(5);
    expect(out.officialNear.officialLossPct).toBe(8.5);
    expect(out.totalLossPct).toBe(8.5);
    expect(out.canonicalNear?.nearEngineMode).toBe("canonical_raycast");
  });

  it("canonical skipped → legacy officiel, fallbackTriggered", () => {
    const out = mergeOfficialNearShading(
      legacyBase(),
      {
        type: "skipped",
        reasonCode: "NO_ROOF_STATE",
        diagnostics: ["no roof"],
      },
      panels
    );
    expect(out.officialNear.engine).toBe("legacy_polygon");
    expect(out.officialNear.fallbackTriggered).toBe(true);
    expect(out.officialNear.canonicalRejectedBecause).toBe("NO_ROOF_STATE");
    expect(out.totalLossPct).toBe(12);
    expect(out.canonicalNear?.nearEngineMode).toBe("legacy_fallback");
  });

  it("flag off (not_attempted) → legacy, pas de fallback", () => {
    const out = mergeOfficialNearShading(
      legacyBase(),
      { type: "not_attempted", reason: "CANONICAL_NEAR_FLAG_OFF" },
      panels
    );
    expect(out.officialNear.engine).toBe("legacy_polygon");
    expect(out.officialNear.fallbackTriggered).toBe(false);
    expect(out.canonicalNear).toBeUndefined();
  });
});
