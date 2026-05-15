/**
 * Rapports d'échec pipeline 3D officiel — console.error explicite (pas de swallow).
 * Objectif : savoir exactement pourquoi `official_ok` est false avant fallback emergency.
 */

import type { CanonicalSceneValidationResult } from "../validation/validateCanonicalScene3DInput";

export type OfficialPipelineDiagnosticsDigest = {
  readonly errorCount: number;
  readonly warningCount: number;
  readonly firstError: { readonly code: string; readonly message: string; readonly context?: unknown } | null;
  readonly firstWarning: { readonly code: string; readonly message: string; readonly context?: unknown } | null;
  readonly errorCodes: readonly string[];
};

export function digestOfficialPipelineDiagnostics(
  diagnostics: CanonicalSceneValidationResult["diagnostics"],
): OfficialPipelineDiagnosticsDigest {
  const firstErr = diagnostics.errors[0];
  const firstWarn = diagnostics.warnings[0];
  return {
    errorCount: diagnostics.errors.length,
    warningCount: diagnostics.warnings.length,
    firstError: firstErr
      ? { code: firstErr.code, message: firstErr.message, ...(firstErr.context != null ? { context: firstErr.context } : {}) }
      : null,
    firstWarning: firstWarn
      ? { code: firstWarn.code, message: firstWarn.message, ...(firstWarn.context != null ? { context: firstWarn.context } : {}) }
      : null,
    errorCodes: diagnostics.errors.map((e) => e.code),
  };
}

export function reportOfficialSolarPipelineFailure(args: {
  readonly where: string;
  readonly stage: string;
  readonly diagnostics?: CanonicalSceneValidationResult["diagnostics"];
  readonly roofTruthStage?: "pre_roof_validation" | "roof_truth_build" | "post_derivation_validation";
  readonly exception?: unknown;
  readonly extra?: Record<string, unknown>;
}): void {
  const digest = args.diagnostics ? digestOfficialPipelineDiagnostics(args.diagnostics) : null;
  let stack: string | undefined;
  let exceptionMessage: string | undefined;
  if (args.exception instanceof Error) {
    exceptionMessage = args.exception.message;
    stack = args.exception.stack ?? "(no stack)";
  } else if (args.exception != null) {
    exceptionMessage = String(args.exception);
  }

  console.error("[OFFICIAL-3D-PIPELINE-FAIL]", {
    where: args.where,
    stage: args.stage,
    roofTruthStage: args.roofTruthStage,
    diagnosticsDigest: digest,
    exceptionMessage,
    stack,
    extra: args.extra,
  });
}
