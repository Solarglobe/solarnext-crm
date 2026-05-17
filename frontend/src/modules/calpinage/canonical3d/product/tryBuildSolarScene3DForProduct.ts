/**
 * Build runtime → scène 3D **uniquement** lorsque le flag produit autorise la 3D canonical.
 * Prompt 29 — chemin **officiel** CRM quand autorisé.
 * Prompt 30 — en cas de refus flag : erreur explicite ici ; **aucun** enchaînement automatique vers `phase3Viewer`
 * (le filet legacy est un autre bouton / overlay, jamais un fallback silencieux de ce builder).
 * Ne remplace pas `buildSolarScene3DFromCalpinageRuntime` pour tests / parité / sandbox dev.
 */

import {
  buildSolarScene3DFromCalpinageRuntime,
  type BuildSolarScene3DFromCalpinageRuntimeOptions,
} from "../buildSolarScene3DFromCalpinageRuntime";
import type { ProductPipeline3DDiagnostics } from "../buildSolarScene3DFromCalpinageRuntimeCore";
import { isCanonical3DProductMountAllowed } from "../featureFlags";
import { computeMinimalHouse3DEligibility, type MinimalHouse3DBuildDiagnostics } from "../fallback/fallbackMinimalHouse3D";
import {
  emptyCanonical3DGeometryProvenance,
  type Canonical3DGeometryProvenanceDiagnostics,
} from "../../integration/readOfficialCalpinageGeometryForCanonical3D";
import { emptyRoofHeightSignalDiagnostics, type RoofHeightSignalDiagnostics } from "../builder/roofHeightSignalDiagnostics";
import { emptyRoofReconstructionQualityDiagnostics, type RoofReconstructionQualityDiagnostics } from "../builder/roofReconstructionQuality";
import { emptyPvBindingDiagnostics, type PvBindingDiagnostics } from "../pvPanels/pvBindingDiagnostics";
import type { Validate2DTo3DCoherenceResult } from "../types/scene2d3dCoherence";
import type { CanonicalSceneValidationResult } from "../validation/validateCanonicalScene3DInput";
import type { SolarScene3D } from "../types/solarScene3d";

const PRODUCT_CTX = { productStrictStatePans: true } as const;

function emptyProductPipelineDiagnostics(): ProductPipeline3DDiagnostics {
  return {
    messages: [],
    panSource: "STATE_PANS_STRICT",
    legacyInputMode: "LEGACY_RICH_INPUT_NOT_USED",
    buildingFallbackUsed: false,
  };
}

/** Résultat produit : même cœur que le builder + champs optionnels lorsque le flag coupe la 3D. */
export type BuildSolarScene3DForProductResult = {
  readonly ok: boolean;
  readonly is3DEligible: boolean;
  readonly scene: SolarScene3D | null;
  readonly coherence: Validate2DTo3DCoherenceResult | null;
  readonly diagnostics: CanonicalSceneValidationResult["diagnostics"];
  readonly minimalHouse3DDiagnostics?: MinimalHouse3DBuildDiagnostics;
  readonly geometryProvenance?: Canonical3DGeometryProvenanceDiagnostics;
  readonly roofHeightSignal?: RoofHeightSignalDiagnostics;
  readonly roofReconstructionQuality?: RoofReconstructionQualityDiagnostics;
  readonly pvBindingDiagnostics?: PvBindingDiagnostics;
  readonly productPipeline3DDiagnostics?: ProductPipeline3DDiagnostics;
  readonly disabledByFlag?: boolean;
};

export function tryBuildSolarScene3DForProduct(
  runtime: unknown,
  options?: BuildSolarScene3DFromCalpinageRuntimeOptions,
): BuildSolarScene3DForProductResult {
  if (!isCanonical3DProductMountAllowed()) {
    const e = computeMinimalHouse3DEligibility({ state: runtime, worldResolved: false });
    return {
      ok: false,
      is3DEligible: false,
      scene: null,
      coherence: null,
      diagnostics: {
        errors: [
          {
            code: "CANONICAL_3D_PRODUCT_DISABLED",
            message:
              "3D canonical produit désactivée (flag OFF). Activer VITE_CALPINAGE_CANONICAL_3D ou window.__CALPINAGE_CANONICAL_3D__.",
          },
        ],
        warnings: [],
        stats: {
          panCount: 0,
          obstacleCount: 0,
          panelCount: 0,
          invalidPans: 0,
          invalidObstacles: 0,
          invalidPanels: 0,
        },
      },
      minimalHouse3DDiagnostics: {
        ...e,
        roofGeometrySource: "REAL_ROOF_PANS",
        fallbackReason: null,
      },
      geometryProvenance: emptyCanonical3DGeometryProvenance(runtime, 0, PRODUCT_CTX),
      roofHeightSignal: emptyRoofHeightSignalDiagnostics(),
      roofReconstructionQuality: emptyRoofReconstructionQualityDiagnostics(),
      pvBindingDiagnostics: emptyPvBindingDiagnostics(),
      productPipeline3DDiagnostics: emptyProductPipelineDiagnostics(),
      disabledByFlag: true,
    };
  }
  const r = buildSolarScene3DFromCalpinageRuntime(runtime, options);
  return { ...r, disabledByFlag: false };
}
