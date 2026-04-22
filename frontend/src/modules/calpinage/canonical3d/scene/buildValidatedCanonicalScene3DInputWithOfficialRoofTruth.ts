/**
 * Chaîne canonique « toit officiel » : prépare le runtime, scène avec pans différés,
 * validation avec `allowEmptyRoofPansPendingDerivation`, construction RoofTruth,
 * pans dérivés des patches, validation finale — même logique que
 * `buildSolarScene3DFromCalpinageRuntimeCore` avant fusion des panneaux.
 */

import {
  buildCanonicalScene3DInput,
  computeCanonicalScene3DId,
  type CanonicalScene3DInput,
} from "../adapters/buildCanonicalScene3DInput";
import { deriveCanonicalPans3DFromRoofPlanePatches } from "../adapters/deriveCanonicalPans3DFromRoofPlanePatches";
import type { BuildRoofModel3DResult, RoofGeometryFidelityMode } from "../builder/buildRoofModel3DFromLegacyGeometry";
import type { LegacyRoofGeometryInput } from "../builder/legacyInput";
import type { AutopsyLegacyRoofPath } from "../dev/runtime3DAutopsy";
import type { PlacementEngineLike } from "../../integration/enrichPanelsForCanonicalShading";
import {
  validateCanonicalScene3DInput,
  type CanonicalSceneValidationResult,
  type ValidateCanonicalScene3DInputOptions,
} from "../validation/validateCanonicalScene3DInput";
import type { MapCalpinageRoofToLegacyRoofGeometryInputOptions } from "../../integration/mapCalpinageToCanonicalNearShading";
import { resolveOfficialRoofTruthFromRuntime } from "./resolveOfficialRoofTruthFromRuntime";

function withCanonicalScenePansFromDerivedRoofTruth(
  scene: CanonicalScene3DInput,
  pans: CanonicalScene3DInput["roof"]["pans"],
): CanonicalScene3DInput {
  return {
    ...scene,
    sceneId: computeCanonicalScene3DId(pans, scene.obstacles.items, scene.panels.items),
    roof: { pans: [...pans] },
    diagnostics: {
      ...scene.diagnostics,
      stats: {
        ...scene.diagnostics.stats,
        panCount: pans.length,
      },
    },
  };
}

export type BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthOptions = {
  readonly getAllPanels?: () => unknown[] | null | undefined;
  readonly placementEngine?: PlacementEngineLike | null;
  readonly allowBuildingContourFallback?: boolean;
  readonly roofGeometryFidelityMode?: RoofGeometryFidelityMode;
  /** Ex. `optimalSingleBuildingLegacyRoofMapOptions()` pour un dossier une maison. */
  readonly legacyRoofMapOptions?: MapCalpinageRoofToLegacyRoofGeometryInputOptions;
  readonly validateCanonicalScene3DInputOptions?: Pick<
    ValidateCanonicalScene3DInputOptions,
    "strict" | "autoFilter"
  >;
};

export type BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthOk = {
  readonly ok: true;
  readonly scene: CanonicalScene3DInput;
  readonly roofRes: BuildRoofModel3DResult;
  readonly legacy: LegacyRoofGeometryInput;
  readonly autopsyLegacyPath: AutopsyLegacyRoofPath;
};

export type BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthFail = {
  readonly ok: false;
  readonly stage: "pre_roof_validation" | "roof_truth_build" | "post_derivation_validation";
  readonly diagnostics: CanonicalSceneValidationResult["diagnostics"];
  readonly is3DEligible: boolean;
  readonly autopsyLegacyPath?: AutopsyLegacyRoofPath;
};

export type BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthResult =
  | BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthOk
  | BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthFail;

export function buildValidatedCanonicalScene3DInputWithOfficialRoofTruth(
  runtime: unknown,
  options?: BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthOptions,
): BuildValidatedCanonicalScene3DInputWithOfficialRoofTruthResult {
  resolveOfficialRoofTruthFromRuntime(runtime, { phase: "prepare" });

  const validateOpts = options?.validateCanonicalScene3DInputOptions;

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

  let validation = validateCanonicalScene3DInput(canonicalScene, {
    ...validateOpts,
    allowEmptyRoofPansPendingDerivation: true,
  });

  if (!validation.ok || !validation.scene) {
    return {
      ok: false,
      stage: "pre_roof_validation",
      diagnostics: validation.diagnostics,
      is3DEligible: validation.is3DEligible,
    };
  }

  const roofTruth = resolveOfficialRoofTruthFromRuntime(runtime, {
    phase: "build",
    validatedCanonicalScene: validation.scene,
    roofGeometryFidelityMode: options?.roofGeometryFidelityMode,
    legacyRoofMapOptions: options?.legacyRoofMapOptions,
  });

  if (!roofTruth.ok) {
    return {
      ok: false,
      stage: "roof_truth_build",
      diagnostics: {
        errors: [
          {
            code: "SCENE_BUILD_FAILED",
            message:
              "Impossible de reconstruire le modèle toiture officiel (relevé incomplet ou incohérent).",
          },
        ],
        warnings: validation.diagnostics.warnings,
        stats: validation.diagnostics.stats,
      },
      is3DEligible: false,
      autopsyLegacyPath: roofTruth.autopsyLegacyPath,
    };
  }

  const { legacy, roofRes, autopsyLegacyPath } = roofTruth;
  const derivedPans = deriveCanonicalPans3DFromRoofPlanePatches({
    roofPlanePatches: roofRes.model.roofPlanePatches,
    metersPerPixel: validation.scene.world.metersPerPixel,
    northAngleDeg: validation.scene.world.northAngleDeg,
  });
  const sceneWithRoofTruthPans = withCanonicalScenePansFromDerivedRoofTruth(validation.scene, derivedPans);
  validation = validateCanonicalScene3DInput(sceneWithRoofTruthPans, validateOpts);

  if (!validation.ok || !validation.scene) {
    return {
      ok: false,
      stage: "post_derivation_validation",
      diagnostics: validation.diagnostics,
      is3DEligible: validation.is3DEligible,
      autopsyLegacyPath,
    };
  }

  return {
    ok: true,
    scene: validation.scene,
    roofRes,
    legacy,
    autopsyLegacyPath,
  };
}
