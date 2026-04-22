/**
 * Preuves Prompt 10 : assembleur premium branché sur SolarScene3D + rapport validation réel (pas cosmétique seul).
 */

import { describe, expect, it } from "vitest";
import { buildDemoSolarScene3D } from "../../demoSolarScene3d";
import { buildPremiumHouse3DScene } from "../buildPremiumHouse3DScene";
import { CANONICAL_HOUSE_3D_VALIDATION_REPORT_SCHEMA_ID } from "../../../validation/canonicalHouse3DValidationCodes";
import type { CanonicalHouse3DValidationBlockReport } from "../../../validation/canonicalHouse3DValidationModel";
import type { CanonicalHouse3DValidationReport } from "../../../validation/canonicalHouse3DValidationModel";

function emptyBlock(): CanonicalHouse3DValidationBlockReport {
  return { status: "ok", errorCount: 0, warningCount: 0, infoCount: 0, diagnostics: [] };
}

function stubReport(overrides: Partial<CanonicalHouse3DValidationReport>): CanonicalHouse3DValidationReport {
  const base: CanonicalHouse3DValidationReport = {
    schemaId: CANONICAL_HOUSE_3D_VALIDATION_REPORT_SCHEMA_ID,
    validatedAtIso: "2026-01-01T00:00:00.000Z",
    globalValidity: true,
    globalQualityLevel: "clean",
    isBuildableForViewer: true,
    isBuildableForPremium3D: true,
    isBuildableForShading: true,
    isBuildableForPV: true,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
    buildingValidation: emptyBlock(),
    roofTopologyValidation: emptyBlock(),
    roofPlanesValidation: emptyBlock(),
    roofIntersectionsValidation: emptyBlock(),
    roofBuildingBindingValidation: emptyBlock(),
    roofAnnexesValidation: emptyBlock(),
    globalGeometryValidation: emptyBlock(),
  };
  return { ...base, ...overrides };
}

describe("buildPremiumHouse3DScene (Prompt 10)", () => {
  const scene = buildDemoSolarScene3D();

  it("maison simple : schéma stable + mode presentation allume toit et panneaux", () => {
    const a = buildPremiumHouse3DScene({ scene, viewMode: "presentation" });
    expect(a.schemaId).toBe("premium-house-3d-scene-assembly-v1");
    expect(a.layers.showRoof && a.layers.showPanels).toBe(true);
    expect(a.lighting.shadowMapSize).toBe(2048);
    expect(a.validation.source).toBe("absent");
    expect(a.validation.qualityLevel).toBeNull();
  });

  it("mode technical renforce arêtes et autorise lignes structurantes si ridges présents", () => {
    const a = buildPremiumHouse3DScene({ scene, viewMode: "technical" });
    expect(a.materials.roofEdgeLine.color).toBe(0xffb74d);
    expect(a.layers.showStructuralRidgeLines).toBe(scene.roofModel.roofRidges.length > 0);
  });

  it("mode pv : boost panneaux + contours lisibles", () => {
    const a = buildPremiumHouse3DScene({ scene, viewMode: "pv" });
    expect(a.pvBoost.panelEmissiveIntensityBonus).toBeGreaterThan(0);
    expect(a.pvBoost.outlinePanelsWhenNotInspecting).toBe(true);
  });

  it("mode validation : soleil coupé, excerpt diagnostics si rapport fourni", () => {
    const report = stubReport({
      globalValidity: false,
      globalQualityLevel: "invalid",
      errorCount: 1,
      buildingValidation: {
        status: "error",
        errorCount: 1,
        warningCount: 0,
        infoCount: 0,
        diagnostics: [
          {
            code: "BUILDING_SHELL_OPEN",
            severity: "error",
            message: "Coque ouverte",
          },
        ],
      },
    });
    const a = buildPremiumHouse3DScene({ scene, viewMode: "validation", geometryValidationReport: report });
    expect(a.layers.showSun).toBe(false);
    expect(a.validation.accent).toBe("critical");
    expect(a.validation.diagnosticCodesExcerpt).toContain("BUILDING_SHELL_OPEN");
  });

  it("presentation + clean : pas de message client obligatoire (honnêteté sans bruit)", () => {
    const report = stubReport({ globalQualityLevel: "clean", globalValidity: true });
    const a = buildPremiumHouse3DScene({
      scene,
      viewMode: "presentation",
      geometryValidationReport: report,
    });
    expect(a.validation.labelFr).toBe("");
    expect(a.validation.accent).toBe("none");
  });

  it("presentation + invalid : barre critique + texte (ne pas embellir une géométrie fausse)", () => {
    const report = stubReport({
      globalValidity: false,
      globalQualityLevel: "invalid",
      errorCount: 2,
    });
    const a = buildPremiumHouse3DScene({
      scene,
      viewMode: "presentation",
      geometryValidationReport: report,
    });
    expect(a.validation.accent).toBe("critical");
    expect(a.validation.labelFr.length).toBeGreaterThan(10);
  });
});
