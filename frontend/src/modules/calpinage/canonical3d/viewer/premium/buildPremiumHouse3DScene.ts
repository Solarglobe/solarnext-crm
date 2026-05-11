/**
 * Assembleur officiel rendu premium Maison 3D (Prompt 10).
 *
 * Entrées : `SolarScene3D` (chaîne canonical affichable) + mode + rapport validation optionnel.
 * Sortie : jeton de scène (matériaux, couches, lumière, honnêteté géométrique) — **aucun** recalcul métier.
 */

import type { SolarScene3D } from "../../types/solarScene3d";
import type { CanonicalHouse3DValidationReport } from "../../validation/canonicalHouse3DValidationModel";
import type {
  PremiumGeometryTrustAccent,
  PremiumHouse3DSceneAssembly,
  PremiumHouse3DValidationPresentation,
} from "./premiumHouse3DSceneTypes";
import { PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID } from "./premiumHouse3DSceneTypes";
import type { PremiumHouse3DViewMode } from "./premiumHouse3DViewModes";

export interface BuildPremiumHouse3DSceneInput {
  readonly scene: SolarScene3D;
  readonly viewMode: PremiumHouse3DViewMode;
  /**
   * Rapport `validateCanonicalHouse3DGeometry` (Prompt 9) — si absent, le rendu n’invente pas un niveau de qualité.
   */
  readonly geometryValidationReport?: CanonicalHouse3DValidationReport | null;
}

function excerptDiagnosticCodes(report: CanonicalHouse3DValidationReport, maxCodes: number): string[] {
  const blocks = [
    report.buildingValidation,
    report.roofTopologyValidation,
    report.roofPlanesValidation,
    report.roofIntersectionsValidation,
    report.roofBuildingBindingValidation,
    report.roofAnnexesValidation,
    report.globalGeometryValidation,
  ];
  const out: string[] = [];
  for (const b of blocks) {
    for (const d of b.diagnostics) {
      if (d.severity === "error" || d.severity === "warning") {
        if (!out.includes(d.code)) out.push(d.code);
        if (out.length >= maxCodes) return out;
      }
    }
  }
  return out;
}

function validationPresentation(
  report: CanonicalHouse3DValidationReport | null | undefined,
  viewMode: PremiumHouse3DViewMode,
): PremiumHouse3DValidationPresentation {
  if (report == null) {
    return {
      qualityLevel: null,
      globalValidity: null,
      source: "absent",
      labelFr:
        viewMode === "validation"
          ? "Validation géométrique : non exécutée sur cette vue"
          : "",
      accent: viewMode === "validation" ? "neutral" : "none",
      diagnosticCodesExcerpt: [],
    };
  }
  const q = report.globalQualityLevel;
  let accent: PremiumGeometryTrustAccent;
  if (!report.globalValidity || q === "invalid") accent = "critical";
  else if (q === "ambiguous" || q === "partial") accent = "attention";
  else if (q === "acceptable") accent = "acceptable";
  else accent = "none";

  /** Mode client : pas de bruit si tout est clean ; signal discret si acceptable. */
  if (viewMode === "presentation") {
    if (q === "clean") {
      return {
        qualityLevel: q,
        globalValidity: report.globalValidity,
        source: "report",
        labelFr: "",
        accent: "none",
        diagnosticCodesExcerpt: [],
      };
    }
    if (q === "acceptable") {
      return {
        qualityLevel: q,
        globalValidity: report.globalValidity,
        source: "report",
        labelFr: "Qualité géométrique : acceptable (légers avertissements)",
        accent: "acceptable",
        diagnosticCodesExcerpt: [],
      };
    }
  }

  const labelFr =
    q === "clean"
      ? "Géométrie : conforme (clean)"
      : q === "acceptable"
        ? "Géométrie : exploitable (avertissements mineurs)"
        : q === "partial"
          ? "Géométrie : partielle — fiabilité limitée"
          : q === "ambiguous"
            ? "Géométrie : ambiguë — interprétation incertaine"
            : "Géométrie : non fiable / non exploitable";

  return {
    qualityLevel: q,
    globalValidity: report.globalValidity,
    source: "report",
    labelFr,
    accent,
    diagnosticCodesExcerpt: excerptDiagnosticCodes(report, viewMode === "validation" ? 12 : 4),
  };
}

/**
 * Fix 5 — surcharge de validation si la géométrie toiture vient du repli bâtiment.
 * `roofGeometryFallbackReason` est affiché dans l'excerpt si disponible.
 */
function applyBuildingFallbackOverlay(
  base: PremiumHouse3DValidationPresentation,
  scene: SolarScene3D,
  viewMode: PremiumHouse3DViewMode,
): PremiumHouse3DValidationPresentation {
  if (scene.metadata?.roofGeometrySource !== "FALLBACK_BUILDING_CONTOUR") return base;
  const reason = typeof scene.metadata?.roofGeometryFallbackReason === "string"
    ? scene.metadata.roofGeometryFallbackReason
    : null;
  const upgradedAccent: PremiumGeometryTrustAccent =
    base.accent === "critical" ? "critical"
    : base.accent === "attention" ? "attention"
    : "attention";
  const fallbackLabel = "⚠ Géométrie toiture : contour bâtiment (repli) — dessinez les pans pour la 3D réelle";
  const labelFr = base.labelFr ? `${base.labelFr} · ${fallbackLabel}` : fallbackLabel;
  const extraCodes = reason ? ["FALLBACK_BUILDING_CONTOUR", reason] : ["FALLBACK_BUILDING_CONTOUR"];
  const diagnosticCodesExcerpt = [
    ...base.diagnosticCodesExcerpt.filter((c) => !extraCodes.includes(c)),
    ...extraCodes,
  ].slice(0, 12);
  return { ...base, accent: upgradedAccent, labelFr, diagnosticCodesExcerpt };
}

/**
 * Construit la description de scène premium : styles, visibilités, lumière, disclosure validation.
 */
export function buildPremiumHouse3DScene(input: BuildPremiumHouse3DSceneInput): PremiumHouse3DSceneAssembly {
  const { scene, viewMode } = input;
  const rawValidation = validationPresentation(input.geometryValidationReport, viewMode);
  const validation = applyBuildingFallbackOverlay(rawValidation, scene, viewMode);

  const baseLayers = {
    showRoof: true,
    showRoofEdges: true,
    showStructuralRidgeLines: false,
    showObstacles: true,
    showExtensions: true,
    showPanels: true,
    showPanelShading: true,
    showSun: true,
  };

  switch (viewMode) {
    case "presentation":
      return {
        schemaId: PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID,
        viewMode,
        layers: {
          ...baseLayers,
          showStructuralRidgeLines: false,
          showSun: true,
        },
        materials: {
          roof: { color: 0x4a5c6e, metalness: 0.18, roughness: 0.62 },
          obstacle: { color: 0x7d5e52, metalness: 0.08, roughness: 0.82, flatShading: false },
          extension: { color: 0x4a6b3a, metalness: 0.06, roughness: 0.78, flatShading: false },
          roofEdgeLine: { color: 0xd4b896, opacity: 0.92 },
          structuralRidgeLine: { color: 0xf0e6d2, opacity: 0.95 },
        },
        lighting: { ambientScale: 0.42, keyScale: 1.02, fillScale: 0.28, shadowMapSize: 2048 },
        framingMargin: 1.28,
        backgroundHex: "#0f1218",
        validation,
        pvBoost: {
          panelMetalness: 0.26,
          panelRoughness: 0.42,
          panelEmissiveIntensityBonus: 0,
          outlinePanelsWhenNotInspecting: false,
        },
      };
    case "technical":
      return {
        schemaId: PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID,
        viewMode,
        layers: {
          ...baseLayers,
          showStructuralRidgeLines: scene.roofModel.roofRidges.length > 0,
          showSun: true,
        },
        materials: {
          roof: { color: 0x556878, metalness: 0.12, roughness: 0.72 },
          obstacle: { color: 0x8b7355, metalness: 0.05, roughness: 0.88, flatShading: true },
          extension: { color: 0x5d7a45, metalness: 0.05, roughness: 0.86, flatShading: true },
          roofEdgeLine: { color: 0xffb74d, opacity: 1 },
          structuralRidgeLine: { color: 0xffe0b2, opacity: 1 },
        },
        lighting: { ambientScale: 0.48, keyScale: 1.05, fillScale: 0.32, shadowMapSize: 1024 },
        framingMargin: 1.22,
        backgroundHex: "#0c0f14",
        validation,
        pvBoost: {
          panelMetalness: 0.22,
          panelRoughness: 0.48,
          panelEmissiveIntensityBonus: 0.02,
          outlinePanelsWhenNotInspecting: false,
        },
      };
    case "validation":
      return {
        schemaId: PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID,
        viewMode,
        layers: {
          ...baseLayers,
          showStructuralRidgeLines: true,
          showSun: false,
        },
        materials: {
          roof: { color: 0x5a6d7e, metalness: 0.1, roughness: 0.75 },
          obstacle: { color: 0x866a5e, metalness: 0.05, roughness: 0.9, flatShading: true },
          extension: { color: 0x567d40, metalness: 0.05, roughness: 0.88, flatShading: true },
          roofEdgeLine: { color: 0xffcc80, opacity: 1 },
          structuralRidgeLine: { color: 0xfff3e0, opacity: 0.98 },
        },
        lighting: { ambientScale: 0.52, keyScale: 0.95, fillScale: 0.38, shadowMapSize: 1024 },
        framingMargin: 1.2,
        backgroundHex: "#0a0d12",
        validation,
        pvBoost: {
          panelMetalness: 0.2,
          panelRoughness: 0.52,
          panelEmissiveIntensityBonus: 0,
          outlinePanelsWhenNotInspecting: true,
        },
      };
    case "pv":
      return {
        schemaId: PREMIUM_HOUSE_3D_SCENE_ASSEMBLY_SCHEMA_ID,
        viewMode,
        layers: {
          ...baseLayers,
          showStructuralRidgeLines: false,
          showSun: true,
        },
        materials: {
          roof: { color: 0x455a68, metalness: 0.14, roughness: 0.68 },
          obstacle: { color: 0x6d5346, metalness: 0.06, roughness: 0.85, flatShading: false },
          extension: { color: 0x3d5230, metalness: 0.06, roughness: 0.8, flatShading: false },
          roofEdgeLine: { color: 0xc9b79a, opacity: 0.85 },
          structuralRidgeLine: { color: 0xe8dcc8, opacity: 0.9 },
        },
        lighting: { ambientScale: 0.45, keyScale: 1.08, fillScale: 0.3, shadowMapSize: 2048 },
        framingMargin: 1.26,
        backgroundHex: "#0e1117",
        validation,
        pvBoost: {
          panelMetalness: 0.32,
          panelRoughness: 0.36,
          panelEmissiveIntensityBonus: 0.055,
          outlinePanelsWhenNotInspecting: true,
        },
      };
    default: {
      const _exhaustive: never = viewMode;
      return _exhaustive;
    }
  }
}
