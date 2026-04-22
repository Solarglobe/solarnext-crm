import { describe, expect, it } from "vitest";
import { buildRoofQualityPhaseAActionPlan } from "../roofQualityPhaseAActionPlan";
import type { RoofReconstructionQualityDiagnostics } from "../../builder/roofReconstructionQuality";

function baseDiag(
  overrides: Partial<RoofReconstructionQualityDiagnostics> = {},
): RoofReconstructionQualityDiagnostics {
  return {
    roofReconstructionQuality: "TRUTHFUL",
    panCount: 1,
    solvedPanCount: 1,
    partiallySolvedPanCount: 0,
    fallbackPanCount: 0,
    sharedEdgeResolvedCount: 0,
    sharedEdgeConflictCount: 0,
    structuralConstraintCount: 0,
    roofTopologyWarnings: [],
    perPanTruth: [{ panId: "pan-a", truthClass: "TRUTHFUL" }],
    ...overrides,
  };
}

describe("buildRoofQualityPhaseAActionPlan", () => {
  it("TRUTHFUL sans warning → étape de confirmation", () => {
    const p = buildRoofQualityPhaseAActionPlan(baseDiag());
    expect(p.quality).toBe("TRUTHFUL");
    expect(p.stepsFr.some((s) => s.includes("Aucune action requise"))).toBe(true);
  });

  it("INCOHERENT + INCOHERENT_PANS → étapes harmonisation + liste pans", () => {
    const p = buildRoofQualityPhaseAActionPlan(
      baseDiag({
        roofReconstructionQuality: "INCOHERENT",
        roofTopologyWarnings: ["INCOHERENT_PANS:2"],
        perPanTruth: [
          { panId: "p1", truthClass: "INCOHERENT" },
          { panId: "p2", truthClass: "TRUTHFUL" },
        ],
      }),
    );
    expect(p.stepsFr.some((s) => s.includes("harmoniser"))).toBe(true);
    expect(p.panChecks.filter((x) => x.panId === "p1")[0]?.truthClass).toBe("INCOHERENT");
  });

  it("WORLD_XY_CORNER_Z_MISMATCH → étape coins communs", () => {
    const p = buildRoofQualityPhaseAActionPlan(
      baseDiag({
        roofReconstructionQuality: "INCOHERENT",
        roofTopologyWarnings: ["WORLD_XY_CORNER_Z_MISMATCH_CLUSTERS:1"],
        perPanTruth: [{ panId: "a", truthClass: "INCOHERENT" }],
      }),
    );
    expect(p.stepsFr.some((s) => s.includes("arête commune"))).toBe(true);
  });
});
