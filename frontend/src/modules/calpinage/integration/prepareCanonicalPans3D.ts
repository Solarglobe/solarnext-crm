/**
 * Point d’entrée minimal pour préparer les pans 3D canoniques depuis le runtime calpinage.
 * Ne déclenche aucun rendu, shading ni persistance — uniquement la donnée géométrique.
 *
 * Usage typique (après montage calpinage) :
 *   prepareCanonicalPans3DFromCalpinageState(window.CALPINAGE_STATE)
 */

import {
  buildCanonicalPans3DFromRuntime,
  type BuildCanonicalPans3DFromRuntimeOptions,
  type BuildCanonicalPans3DFromRuntimeInput,
  type CanonicalPans3DResult,
} from "../canonical3d/adapters/buildCanonicalPans3DFromRuntime";

type PrepareCanonicalPans3DOptions = BuildCanonicalPans3DFromRuntimeOptions & {
  readonly metersPerPixel?: number;
  readonly northAngleDeg?: number;
  readonly heightResolverContext?: BuildCanonicalPans3DFromRuntimeInput["heightResolverContext"];
  readonly productStrictStatePansOnly?: boolean;
};

/**
 * Construit les pans 3D à partir de l’état calpinage courant.
 * Les surcharges `metersPerPixel` / `northAngleDeg` permettent les tests sans `state.roof` complet.
 */
export function prepareCanonicalPans3DFromCalpinageState(
  state: unknown,
  options?: PrepareCanonicalPans3DOptions,
): CanonicalPans3DResult {
  const { metersPerPixel, northAngleDeg, heightResolverContext, productStrictStatePansOnly, ...innerOptions } =
    options ?? {};
  return buildCanonicalPans3DFromRuntime({
    state,
    metersPerPixel,
    northAngleDeg,
    heightResolverContext,
    productStrictStatePansOnly,
    options: innerOptions,
  });
}
