/**
 * Niveau 0 — instrumentation + garde-fous produit (aucune reconstruction silencieuse).
 * Les consommateurs lisent `SolarScene3D.metadata.buildGuards` (et `omitBuildingShell`, toujours false depuis niveau 1).
 */

import type { RoofGeometryFidelityMode } from "../builder/buildRoofModel3DFromLegacyGeometry";
import type { RoofHeightSignalDiagnostics } from "../builder/roofHeightSignalDiagnostics";
import type { RoofReconstructionQualityDiagnostics } from "../builder/roofReconstructionQuality";
import type { BuildingShellContourSource } from "../types/building-shell-3d";
import type { SolarSceneBuildGuard } from "../types/solarScene3d";

export type CalpinageLevel0GuardContext = {
  readonly panCount: number;
  /** `null` si aucune emprise résolue (le shell ne sera de toute façon pas construit). */
  readonly shellContourSource: BuildingShellContourSource | null;
  readonly roofQuality: RoofReconstructionQualityDiagnostics;
  readonly roofHeightSignal: RoofHeightSignalDiagnostics;
  /** Mode toiture du pipeline (niveau 2 — défaut produit : fidèle aux cotes explicites, voir `DEFAULT_PRODUCT_ROOF_GEOMETRY_FIDELITY_MODE`). */
  readonly roofGeometryFidelityMode?: RoofGeometryFidelityMode;
  /**
   * Aire horizontale monde (m²) du contour dans `sourceTrace.metrics` — Niveau 4 (`polygonHorizontalAreaM2FromImagePx`).
   */
  readonly roofOutlineHorizontalAreaM2?: number | null;
};

export function buildCalpinageLevel0Guards(ctx: CalpinageLevel0GuardContext): {
  readonly guards: readonly SolarSceneBuildGuard[];
  /** Réservé compat API — le shell n’est plus omis ici. */
  readonly omitBuildingShell: boolean;
} {
  const guards: SolarSceneBuildGuard[] = [];

  if (ctx.roofGeometryFidelityMode === "fidelity") {
    guards.push({
      code: "LEVEL2_ROOF_GEOMETRY_FIDELITY_MODE",
      severity: "info",
      message:
        "Toiture 3D en mode fidélité : priorité aux hauteurs explicites sur les sommets ; pas de raffinement des normales sur arêtes structurantes ; garde-fous unify/impose atténués pour les arêtes entièrement relevées.",
    });
  }

  if (ctx.roofGeometryFidelityMode === "hybrid") {
    guards.push({
      code: "LEVEL2_ROOF_GEOMETRY_HYBRID_MODE",
      severity: "info",
      message:
        "Toiture 3D en mode hybride : collage inter-pans renforcé (raffinement normales) tout en préservant les cotes explicites dans la chaîne unify/impose.",
    });
  }

  const footprintM2 = ctx.roofOutlineHorizontalAreaM2;
  if (typeof footprintM2 === "number" && Number.isFinite(footprintM2) && footprintM2 > 0) {
    guards.push({
      code: "LEVEL4_SOURCE_TRACE_ROOF_FOOTPRINT_M2",
      severity: "info",
      message:
        `Trace source Niveau 4 : emprise toiture horizontale monde ≈ ${footprintM2.toFixed(3)} m² (polygonHorizontalAreaM2FromImagePx) — utilisée pour l’audit ROOF_OUTLINE_AREA_MISMATCH.`,
    });
  }

  if (ctx.panCount > 0 && ctx.shellContourSource == null) {
    guards.push({
      code: "LEVEL1_SHELL_REQUIRES_BUILDING_CONTOUR",
      severity: "info",
      message:
        "Enveloppe 3D : aucun prisme sans contour bâti valide — tracez le contour du bâtiment pour afficher le shell (option emprise = contour).",
    });
  }

  const q = ctx.roofQuality.roofReconstructionQuality;
  if (q === "INCOHERENT") {
    guards.push({
      code: "LEVEL0_ROOF_QUALITY_INCOHERENT",
      severity: "warning",
      message: "Reconstruction toiture classée incohérente — interpréter le rendu 3D avec prudence.",
    });
  } else if (q === "PARTIAL") {
    guards.push({
      code: "LEVEL0_ROOF_QUALITY_PARTIAL",
      severity: "info",
      message: "Toiture 3D partiellement résolue (certaines faces ou contraintes en repli ou résiduel modéré).",
    });
  } else if (q === "FALLBACK") {
    guards.push({
      code: "LEVEL0_ROOF_QUALITY_FALLBACK",
      severity: "info",
      message: "Toiture 3D largement inférée (signal de hauteur faible ou cotes manquantes sur les sommets).",
    });
  }

  if (ctx.roofQuality.sharedEdgeConflictCount > 0) {
    guards.push({
      code: "LEVEL0_SHARED_EDGE_CONFLICTS",
      severity: "warning",
      message: `Conflits sur arêtes partagées entre pans (${ctx.roofQuality.sharedEdgeConflictCount}) — vérifier le collage 2D des pans.`,
    });
  }

  if (ctx.roofHeightSignal.heightSignalStatus === "MISSING" && ctx.panCount > 0) {
    guards.push({
      code: "LEVEL0_HEIGHT_SIGNAL_MISSING",
      severity: "info",
      message: "Aucune cote de hauteur sur les sommets : la pente 3D repose sur des valeurs par défaut.",
    });
  }

  return { guards, omitBuildingShell: false };
}
