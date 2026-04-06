/**
 * Préparation lecture seule des obstacles / extensions / volumes ombrants → géométrie 3D canonique.
 * Aucun rendu Three.js, shading ni persistance.
 */

import {
  buildCanonicalObstacles3DFromRuntime,
  type BuildCanonicalObstacles3DFromRuntimeInput,
  type BuildCanonicalObstacles3DFromRuntimeOptions,
  type CanonicalObstacle3DResult,
} from "../canonical3d/adapters/buildCanonicalObstacles3DFromRuntime";

type PrepareOpts = BuildCanonicalObstacles3DFromRuntimeOptions & {
  readonly metersPerPixel?: number;
  readonly northAngleDeg?: number;
  readonly heightResolverContext?: BuildCanonicalObstacles3DFromRuntimeInput["heightResolverContext"];
};

export function prepareCanonicalObstacles3DFromCalpinageState(
  state: unknown,
  options?: PrepareOpts,
): CanonicalObstacle3DResult {
  const { metersPerPixel, northAngleDeg, heightResolverContext, ...inner } = options ?? {};
  return buildCanonicalObstacles3DFromRuntime({
    state,
    metersPerPixel,
    northAngleDeg,
    heightResolverContext,
    options: inner,
  });
}
