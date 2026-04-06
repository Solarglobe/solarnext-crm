/**
 * Qualité et diagnostics attachés aux entités ou au modèle global.
 * Valeurs discrètes pour éviter les scores magiques non documentés.
 */

export type ConfidenceTier = "high" | "medium" | "low" | "unknown";

export type GeometryDiagnosticSeverity = "info" | "warning" | "error";

export interface GeometryDiagnostic {
  readonly code: string;
  readonly severity: GeometryDiagnosticSeverity;
  readonly message: string;
  /** Contexte minimal typé (pas de any). */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

export interface QualityBlock {
  readonly confidence: ConfidenceTier;
  readonly diagnostics: readonly GeometryDiagnostic[];
}
