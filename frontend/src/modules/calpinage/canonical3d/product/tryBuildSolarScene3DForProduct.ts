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
import { isCanonical3DProductMountAllowed } from "../featureFlags";

export type BuildSolarScene3DForProductResult = ReturnType<typeof buildSolarScene3DFromCalpinageRuntime> & {
  readonly disabledByFlag?: boolean;
};

export function tryBuildSolarScene3DForProduct(
  runtime: unknown,
  options?: BuildSolarScene3DFromCalpinageRuntimeOptions,
): BuildSolarScene3DForProductResult {
  if (!isCanonical3DProductMountAllowed()) {
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
      disabledByFlag: true,
    };
  }
  const r = buildSolarScene3DFromCalpinageRuntime(runtime, options);
  return { ...r, disabledByFlag: false };
}
