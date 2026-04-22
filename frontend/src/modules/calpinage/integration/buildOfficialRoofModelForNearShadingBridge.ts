/**
 * Construit uniquement le modèle toit officiel (même chaîne que le pipeline 3D produit,
 * sans assembler la scène complète) — pour alimenter le cache near quand aucun build 3D
 * récent n’a eu lieu.
 */

import { buildCanonicalScene3DInput } from "../canonical3d/adapters/buildCanonicalScene3DInput";
import type {
  BuildRoofModel3DResult,
  RoofGeometryFidelityMode,
} from "../canonical3d/builder/buildRoofModel3DFromLegacyGeometry";
import {
  isOfficialRoofTruthBuildOk,
  resolveOfficialRoofTruthFromRuntime,
} from "../canonical3d/scene/resolveOfficialRoofTruthFromRuntime";
import { validateCanonicalScene3DInput } from "../canonical3d/validation/validateCanonicalScene3DInput";
import type { PlacementEngineLike } from "./enrichPanelsForCanonicalShading";
import { rememberOfficialRoofModelForNearShading } from "./officialRoofModelNearShadingCache";

export type BuildOfficialRoofModelForNearShadingBridgeOptions = {
  readonly getAllPanels?: () => unknown[] | null | undefined;
  readonly placementEngine?: PlacementEngineLike | null;
  readonly allowBuildingContourFallback?: boolean;
  readonly roofGeometryFidelityMode?: RoofGeometryFidelityMode;
};

/**
 * Retourne `roofRes` aligné sur `buildSolarScene3DFromCalpinageRuntime` (prepare → validation scène → build toit).
 * Met à jour le cache near shading en cas de succès.
 */
export function buildOfficialRoofModelForNearShadingOnly(
  runtime: unknown,
  options?: BuildOfficialRoofModelForNearShadingBridgeOptions,
): BuildRoofModel3DResult | null {
  resolveOfficialRoofTruthFromRuntime(runtime, { phase: "prepare" });

  const canonicalScene = buildCanonicalScene3DInput({
    state: runtime,
    getAllPanels: options?.getAllPanels,
    placementEngine: options?.placementEngine ?? null,
    productPipeline: true,
    deferPlacedPanels: true,
    deferCanonicalPansForOfficialRoof: true,
    ...(options?.allowBuildingContourFallback !== undefined
      ? { allowBuildingContourFallback: options.allowBuildingContourFallback }
      : {}),
  });

  const validation = validateCanonicalScene3DInput(canonicalScene, {
    allowEmptyRoofPansPendingDerivation: true,
  });
  if (!validation.ok || !validation.scene) {
    return null;
  }

  const roofTruth = resolveOfficialRoofTruthFromRuntime(runtime, {
    phase: "build",
    validatedCanonicalScene: validation.scene,
    roofGeometryFidelityMode: options?.roofGeometryFidelityMode,
  });

  if (!isOfficialRoofTruthBuildOk(roofTruth)) {
    return null;
  }

  if (!("roofRes" in roofTruth) || roofTruth.roofRes == null) {
    return null;
  }
  const roofRes = roofTruth.roofRes;
  rememberOfficialRoofModelForNearShading(runtime, roofRes, options?.getAllPanels);
  return roofRes;
}
