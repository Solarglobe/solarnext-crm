/**
 * Façade : assemble la scène 3D canonique depuis l’état calpinage (et/ou injections).
 * Lecture seule sur `state` — aucune mutation.
 */

import {
  buildCanonicalScene3DInput,
  type BuildCanonicalScene3DInput,
  type CanonicalScene3DInput,
} from "../canonical3d/adapters/buildCanonicalScene3DInput";

export function prepareCanonicalScene3DFromCalpinageState(
  state: unknown,
  input?: Omit<BuildCanonicalScene3DInput, "state">,
): CanonicalScene3DInput {
  return buildCanonicalScene3DInput({ ...input, state });
}
