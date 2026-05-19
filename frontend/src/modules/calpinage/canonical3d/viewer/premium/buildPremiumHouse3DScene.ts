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
import { SOLARNEXT_3D_PREMIUM_THEME, PREMIUM_MATERIALS } from "../viewerVisualTokens";

/** Convertit une couleur CSS hex string (#rrggbb) en entier hex Three.js. */
function hexColor(s: string): number {
  return parseInt(s.replace("#", ""), 16);
}

// ── Tokens de matériaux partagés entre les modes ──────────────────────────────

/** Toiture ardoise premium — source de vérité PREMIUM_MATERIALS.ARDOISE. */
const ROOF_ARDOISE = {
  color: hexColor(PREMIUM_MATERIALS.ARDOISE.color),   // 0x383840
  metalness: PREMIUM_MATERIALS.ARDOISE.metalness,      // 0.04
  roughness: PREMIUM_MATERIALS.ARDOISE.roughness,      // 0.84
} as const;

/** Boost PV — face active verre AR monocristallin (PREMIUM_MATERIALS.PV_PANEL). */
const PV_BOOST_PREMIUM = {
  panelMetalness: PREMIUM_MATERIALS.PV_PANEL.metalness,  // 0.72
  panelRoughness: PREMIUM_MATERIALS.PV_PANEL.roughness,  // 0.10
  panelEmissiveIntensityBonus: 0.04,
  outlinePanelsWhenNotInspecting: false,
} as const;

export interface BuildPremiumHouse3DSceneInput {
  readonly scene: SolarScene3D;
  readonly viewMode: PremiumHouse3DViewMode;
  /**
   * Rapport `validateCanonicalHouse3DGeometry` (Prompt 9) — si absent, le rendu n'invente pas un niveau de qualité.
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
  _viewMode: PremiumHouse3DViewMode,
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
          // ROOF_ARDOISE depuis PREMIUM_MATERIALS.ARDOISE (source de vérité PBR)
          roof: ROOF_ARDOISE,
          obstacle: { color: 0x7d5e52, metalness: 0.08, roughness: 0.82, flatShading: false },
          extension: { color: 0x536f43, metalness: 0.06, roughness: 0.78, flatShading: false },
          roofEdgeLine: { color: 0xdbc49a, opacity: 0.88 },
          structuralRidgeLine: { color: 0xfff1d6, opacity: 0.92 },
        },
        lighting: { ambientScale: 0.44, keyScale: 1.12, fillScale: 0.30, shadowMapSize: 2048 },
        framingMargin: 1.28,
        backgroundHex: SOLARNEXT_3D_PREMIUM_THEME.background,
        validation,
        pvBoost: {
          // PV_BOOST_PREMIUM depuis PREMIUM_MATERIALS.PV_PANEL (verre AR monocristallin)
          ...PV_BOOST_PREMIUM,
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
          roof: ROOF_ARDOISE,
          obstacle: { color: 0x8b7355, metalness: 0.05, roughness: 0.88, flatShading: true },
          extension: { color: 0x5d7a45, metalness: 0.05, roughness: 0.86, flatShading: true },
          roofEdgeLine: { color: 0xf0bd72, opacity: 0.96 },
          structuralRidgeLine: { color: 0xffedd5, opacity: 0.96 },
        },
        lighting: { ambientScale: 0.46, keyScale: 1.08, fillScale: 0.30, shadowMapSize: 1024 },
        framingMargin: 1.22,
        backgroundHex: "#0a1018",
        validation,
        pvBoost: {
          ...PV_BOOST_PREMIUM,
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
          roof: ROOF_ARDOISE,
          obstacle: { color: 0x866a5e, metalness: 0.05, roughness: 0.90, flatShading: true },
          extension: { color: 0x567d40, metalness: 0.05, roughness: 0.88, flatShading: true },
          roofEdgeLine: { color: 0xf0bd72, opacity: 0.95 },
          structuralRidgeLine: { color: 0xfff1d6, opacity: 0.94 },
        },
        lighting: { ambientScale: 0.50, keyScale: 0.96, fillScale: 0.36, shadowMapSize: 1024 },
        framingMargin: 1.2,
        backgroundHex: "#090f16",
        validation,
        pvBoost: {
          ...PV_BOOST_PREMIUM,
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
          // Mode PV : ROOF_ARDOISE (source commune) — contraste assuré par l'emissive PV + env maps
          roof: ROOF_ARDOISE,
          obstacle: { color: 0x6d5346, metalness: 0.06, roughness: 0.85, flatShading: false },
          extension: { color: 0x48623a, metalness: 0.06, roughness: 0.80, flatShading: false },
          roofEdgeLine: { color: 0xcdbd9f, opacity: 0.82 },
          structuralRidgeLine: { color: 0xf3e7cf, opacity: 0.86 },
        },
        lighting: { ambientScale: 0.42, keyScale: 1.14, fillScale: 0.28, shadowMapSize: 2048 },
        framingMargin: 1.26,
        backgroundHex: SOLARNEXT_3D_PREMIUM_THEME.background,
        validation,
        pvBoost: {
          // Mode PV : max reflectivité (PREMIUM_MATERIALS.PV_PANEL + bonus emissive)
          ...PV_BOOST_PREMIUM,
          panelEmissiveIntensityBonus: 0.06,
          outlinePanelsWhenNotInspecting: true,
        },
      };
    default: {
      const _exhaustive: never = viewMode;
      return _exhaustive;
    }
  }
}
