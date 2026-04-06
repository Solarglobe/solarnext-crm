/**
 * Enveloppe traçable pour le JSON shading / exports (near) — compatible coexistence legacy.
 */

/** Version du pipeline d’intégration (pas celle du schéma toiture seul). */
export const CANONICAL_NEAR_SHADING_PIPELINE_VERSION = "canonical-near-3d-v2" as const;

/**
 * Bloc optionnel à fusionner dans `meta` / `near` après normalisation.
 * Sérialisable JSON (pas de fonctions, pas de classes).
 */
export interface NearShadingCanonical3dEnvelope {
  readonly pipelineVersion: typeof CANONICAL_NEAR_SHADING_PIPELINE_VERSION;
  /** `canonical_raycast` = moteur 3D ; `legacy_fallback` = nearShadingCore inchangé. */
  readonly nearEngineMode: "canonical_raycast" | "legacy_fallback";
  /** Motif court si fallback ou dégradation. */
  readonly reasonCode?: string;
  readonly diagnostics: readonly string[];
  /** Perte near annuelle proxy (%) alignée sur la série de vecteurs soleil — même définition que nearLossPct quand mode canonical. */
  readonly nearLossPctCanonical?: number;
  /** Fraction ombrée moyenne (agrégat annual). */
  readonly meanShadedFraction?: number;
}

/** Moteur ayant produit la perte near officielle (`totalLossPct`). */
export type NearShadingOfficialEngineId = "canonical_3d" | "legacy_polygon";

/**
 * Contrat produit — pas d’ambiguïté : `officialLossPct` = `totalLossPct` du résultat frontend.
 * `legacyReferenceLossPct` = sortie nearShadingCore (toujours calculée) pour audit / comparaison.
 */
export interface NearShadingOfficialNear {
  readonly engine: NearShadingOfficialEngineId;
  readonly officialLossPct: number;
  readonly legacyReferenceLossPct: number;
  readonly canonicalUsable: boolean;
  readonly fallbackTriggered: boolean;
  readonly canonicalRejectedBecause?: string;
  readonly selectionReason: string;
}
