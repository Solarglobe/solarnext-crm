import { describe, expect, it } from "vitest";
import { emptyRoofHeightSignalDiagnostics } from "../../builder/roofHeightSignalDiagnostics";
import { emptyRoofReconstructionQualityDiagnostics } from "../../builder/roofReconstructionQuality";
import { buildCalpinageLevel0Guards } from "../calpinageLevel0BuildGuards";

describe("buildCalpinageLevel0Guards", () => {
  it("info si pans sans contour bâti → pas de shell (option A)", () => {
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 2,
    };
    const r = buildCalpinageLevel0Guards({
      panCount: 2,
      shellContourSource: null,
      roofQuality,
      roofHeightSignal: { ...emptyRoofHeightSignalDiagnostics(), heightSignalStatus: "SUFFICIENT" },
    });
    expect(r.omitBuildingShell).toBe(false);
    expect(r.guards.some((g) => g.code === "LEVEL1_SHELL_REQUIRES_BUILDING_CONTOUR")).toBe(true);
  });

  it("même info pour un seul pan sans contour", () => {
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 1,
    };
    const r = buildCalpinageLevel0Guards({
      panCount: 1,
      shellContourSource: null,
      roofQuality,
      roofHeightSignal: { ...emptyRoofHeightSignalDiagnostics(), heightSignalStatus: "SUFFICIENT" },
    });
    expect(r.omitBuildingShell).toBe(false);
    expect(r.guards.some((g) => g.code === "LEVEL1_SHELL_REQUIRES_BUILDING_CONTOUR")).toBe(true);
  });

  it("pas d’info contour requis si contour bâti résolu (multi-pans)", () => {
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 2,
    };
    const r = buildCalpinageLevel0Guards({
      panCount: 2,
      shellContourSource: "CALPINAGE_STATE.contours",
      roofQuality,
      roofHeightSignal: { ...emptyRoofHeightSignalDiagnostics(), heightSignalStatus: "SUFFICIENT" },
    });
    expect(r.omitBuildingShell).toBe(false);
    expect(r.guards.some((g) => g.code === "LEVEL1_SHELL_REQUIRES_BUILDING_CONTOUR")).toBe(false);
  });

  it("info niveau 4 si emprise toiture m² présente (trace)", () => {
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 1,
    };
    const r = buildCalpinageLevel0Guards({
      panCount: 1,
      shellContourSource: "CALPINAGE_STATE.contours",
      roofQuality,
      roofHeightSignal: { ...emptyRoofHeightSignalDiagnostics(), heightSignalStatus: "SUFFICIENT" },
      roofOutlineHorizontalAreaM2: 4.25,
    });
    expect(r.guards.some((g) => g.code === "LEVEL4_SOURCE_TRACE_ROOF_FOOTPRINT_M2")).toBe(true);
  });

  it("info niveau 2 si mode toiture fidélité (défaut produit)", () => {
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 1,
    };
    const r = buildCalpinageLevel0Guards({
      panCount: 1,
      shellContourSource: "CALPINAGE_STATE.contours",
      roofQuality,
      roofHeightSignal: { ...emptyRoofHeightSignalDiagnostics(), heightSignalStatus: "SUFFICIENT" },
      roofGeometryFidelityMode: "fidelity",
    });
    expect(r.guards.some((g) => g.code === "LEVEL2_ROOF_GEOMETRY_FIDELITY_MODE")).toBe(true);
  });

  it("info niveau 2 si mode toiture hybride", () => {
    const roofQuality = {
      ...emptyRoofReconstructionQualityDiagnostics(),
      roofReconstructionQuality: "TRUTHFUL" as const,
      panCount: 1,
    };
    const r = buildCalpinageLevel0Guards({
      panCount: 1,
      shellContourSource: "CALPINAGE_STATE.contours",
      roofQuality,
      roofHeightSignal: { ...emptyRoofHeightSignalDiagnostics(), heightSignalStatus: "SUFFICIENT" },
      roofGeometryFidelityMode: "hybrid",
    });
    expect(r.guards.some((g) => g.code === "LEVEL2_ROOF_GEOMETRY_HYBRID_MODE")).toBe(true);
  });
});
