import { describe, expect, it } from "vitest";
import { emptyRoofHeightSignalDiagnostics } from "../../builder/roofHeightSignalDiagnostics";
import { emptyRoofReconstructionQualityDiagnostics } from "../../builder/roofReconstructionQuality";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import { createEmptyRoofModel3D } from "../../utils/factories";
import { buildRoofQualityPhaseBTechnicalProof } from "../roofQualityPhaseBTechnicalProof";

describe("buildRoofQualityPhaseBTechnicalProof", () => {
  it("agrège signal hauteur, compteurs et une ligne par pan dans le résumé support", () => {
    const patch = makeHorizontalSquarePatch("pan-z", 4, 0);
    const model = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 1,
      solvedPanCount: 1,
      partiallySolvedPanCount: 0,
      fallbackPanCount: 0,
      sharedEdgeResolvedCount: 2,
      sharedEdgeConflictCount: 0,
      structuralConstraintCount: 0,
      roofTopologyWarnings: [],
      perPanTruth: [{ panId: "pan-z", truthClass: "TRUTHFUL" as const }],
    };
    const roofHeightSignal = {
      ...emptyRoofHeightSignalDiagnostics(),
      heightSignalStatus: "SUFFICIENT" as const,
      explicitVertexHeightCount: 4,
      interpolatedVertexHeightCount: 0,
      fallbackVertexHeightCount: 0,
      usedSyntheticZeroHeight: false,
      inclinedRoofGeometryTruthful: true,
      heightWarnings: [],
    };
    const b = buildRoofQualityPhaseBTechnicalProof({ model, roofQuality, roofHeightSignal });
    expect(b.heightSignal.status).toBe("SUFFICIENT");
    expect(b.aggregateCounts.panCount).toBe(1);
    expect(b.aggregateCounts.incoherentPanCount).toBe(0);
    expect(b.panTechnical).toHaveLength(1);
    expect(b.panTechnical[0]!.panId).toBe("pan-z");
    expect(b.panTechnical[0]!.planeResidualRmsMm).toBe(0);
    expect(b.panTechnical[0]!.cornerZSpanMm).toBe(0);
    expect(b.supportLinesFr.some((l) => l.includes("pan-z"))).toBe(true);
  });

  it("liste les avertissements topologie et hauteur dans le résumé support", () => {
    const model = createEmptyRoofModel3D();
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "INCOHERENT" as const,
      roofTopologyWarnings: ["INCOHERENT_PANS:0"],
    };
    const roofHeightSignal = {
      ...emptyRoofHeightSignalDiagnostics(),
      heightWarnings: ["TEST_HEIGHT_WARN"],
    };
    const b = buildRoofQualityPhaseBTechnicalProof({ model, roofQuality, roofHeightSignal });
    expect(b.panTechnical).toHaveLength(0);
    expect(b.supportLinesFr.some((l) => l.includes("INCOHERENT_PANS"))).toBe(true);
    expect(b.supportLinesFr.some((l) => l.includes("TEST_HEIGHT_WARN"))).toBe(true);
  });
});
