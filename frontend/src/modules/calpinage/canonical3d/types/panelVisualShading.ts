/**
 * Couche lecture seule pour coloration viewer — pas de vérité métier ombrage supplémentaire.
 * Les pertes affichées proviennent exclusivement du runtime (`shading.perPanel`) ou, en secours viewer,
 * d’un agrégat déjà stocké sur la scène (`nearShadingSnapshot`, fraction ombrée moyenne).
 */

export type PanelVisualShadingState = "AVAILABLE" | "MISSING" | "INVALID";

/** Origine de la valeur affichée (tooltip / audit). */
export type PanelVisualShadingProvenance = "runtime_per_panel" | "near_snapshot_mean_fraction";

export interface PanelVisualShading {
  readonly panelId: string;
  /** Perte connue (runtime) ou équivalent affiché 0–100 (snapshot). */
  readonly lossPct: number | null;
  /** `clamp(1 - lossPct/100, 0, 1)` lorsque la perte est exploitable. */
  readonly qualityScore01: number | null;
  readonly state: PanelVisualShadingState;
  readonly provenance?: PanelVisualShadingProvenance;
}

export interface PanelVisualShadingSummary {
  readonly totalLossPct: number | null;
  readonly nearLossPct: number | null;
  readonly farLossPct: number | null;
  readonly panelCount: number | null;
  readonly computedAt: number | string | null;
  readonly blockingReason?: string | null;
}
