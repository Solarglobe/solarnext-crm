/**
 * Prépare les entrées `PvPanelPlacementInput` depuis le runtime calpinage + patches toiture.
 * Lecture seule — ne modifie pas pvPlacementEngine.
 */

import {
  buildCanonicalPlacedPanelsFromRuntime,
  type BuildCanonicalPlacedPanelsFromRuntimeInput,
  type CanonicalPlacedPanelsResult,
} from "../canonical3d/adapters/buildCanonicalPlacedPanelsFromRuntime";

export function prepareCanonicalPlacedPanelsFromCalpinageState(
  input: BuildCanonicalPlacedPanelsFromRuntimeInput,
): CanonicalPlacedPanelsResult {
  return buildCanonicalPlacedPanelsFromRuntime(input);
}
