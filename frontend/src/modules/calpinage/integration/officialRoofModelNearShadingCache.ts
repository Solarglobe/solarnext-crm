/**
 * Cache partagé du **RoofTruth** (`BuildRoofModel3DResult`) par `sceneRuntimeSignature`.
 *
 * Même empreinte que `officialSolarScene3DGateway` / `computeRuntimeSceneStructuralSignatures` :
 * une seule instance de toiture construite par signature, réutilisable par le viewer 3D (via le
 * pipeline qui appelle `rememberOfficialRoofModelForNearShading`), l’ombrage near canonical,
 * et tout autre consommateur qui passe le même `getAllPanels` que le build officiel.
 *
 * @see ../canonical3d/scene/sceneRuntimeStructuralSignature.ts
 * @see ../canonical3d/scene/officialSolarScene3DGateway.ts
 */

import type { BuildRoofModel3DResult } from "../canonical3d/builder/buildRoofModel3DFromLegacyGeometry";
import { computeRuntimeSceneStructuralSignatures } from "../canonical3d/scene/sceneRuntimeStructuralSignature";

const roofTruthBySceneRuntimeSignature = new Map<string, BuildRoofModel3DResult>();

function resolveSceneRuntimeSignature(
  runtime: unknown,
  getAllPanels?: () => unknown[] | null | undefined,
): string {
  return computeRuntimeSceneStructuralSignatures(runtime, { getAllPanels }).sceneRuntimeSignature;
}

/**
 * Enregistre la toiture officielle pour la signature courante du runtime.
 */
export function rememberOfficialRoofModelForNearShading(
  runtime: unknown,
  roofRes: BuildRoofModel3DResult,
  getAllPanels?: () => unknown[] | null | undefined,
): void {
  const signature = resolveSceneRuntimeSignature(runtime, getAllPanels);
  roofTruthBySceneRuntimeSignature.set(signature, roofRes);
}

/**
 * Retourne la toiture en cache si la signature structurelle du runtime correspond encore.
 */
export function getCachedOfficialRoofModelForNearShading(
  runtime: unknown,
  getAllPanels?: () => unknown[] | null | undefined,
): BuildRoofModel3DResult | null {
  const signature = resolveSceneRuntimeSignature(runtime, getAllPanels);
  return roofTruthBySceneRuntimeSignature.get(signature) ?? null;
}

/**
 * Retire une entrée (ex. `forceStructuralRebuild` sur la passerelle 3D pour cette signature).
 */
export function evictOfficialRoofTruthForSceneRuntimeSignature(sceneRuntimeSignature: string): void {
  roofTruthBySceneRuntimeSignature.delete(sceneRuntimeSignature);
}

export function clearOfficialRoofModelNearShadingCache(): void {
  roofTruthBySceneRuntimeSignature.clear();
}
