import type { GeometryDiagnostic, GeometryTruthStatus } from "../types/quality";
import type { SolarScene3D } from "../types/solarScene3d";

export type ViewerSceneSource = "OFFICIAL" | "EMERGENCY_FALLBACK" | "UNAVAILABLE";

export type ViewerReliabilityIssueCode =
  | "GEOMETRY_INVALID"
  | "OFFICIAL_BUILD_FAILED"
  | "EMERGENCY_FALLBACK_ACTIVE"
  | "RENDER_ERROR"
  | "STALE_SCENE"
  | "DEGRADED_GEOMETRY"
  | "PV_PLACEMENT_INVALID"
  | "UNAVAILABLE";

export interface ViewerOfficialBuildError {
  readonly message: string;
  readonly name?: string;
  readonly stack?: string;
  readonly diagnostics?: unknown;
}

interface ViewerReliabilityBase {
  readonly generation: number;
  readonly renderedGeneration: number | null;
  readonly source: ViewerSceneSource;
  readonly geometryTruthStatus: GeometryTruthStatus | "UNKNOWN";
  readonly officialBuildStatus: "SUCCESS" | "FAILED" | "UNKNOWN";
  readonly officialBuildError: ViewerOfficialBuildError | null;
  readonly fallbackAttempted: boolean;
  readonly fallbackSucceeded: boolean;
  readonly stale: boolean;
  readonly invalidPatchCount: number;
  readonly degradedPatchCount: number;
  readonly lastKnownGoodGeneration: number | null;
  readonly issueCodes: readonly ViewerReliabilityIssueCode[];
  readonly userMessage: string | null;
  readonly technicalDetails: readonly string[];
  readonly diagnostics: readonly GeometryDiagnostic[];
}

export type ViewerReliabilityState =
  | (ViewerReliabilityBase & { readonly kind: "ready" })
  | (ViewerReliabilityBase & { readonly kind: "degraded" })
  | (ViewerReliabilityBase & { readonly kind: "fallback" })
  | (ViewerReliabilityBase & { readonly kind: "invalid" })
  | (ViewerReliabilityBase & { readonly kind: "error" })
  | (ViewerReliabilityBase & { readonly kind: "stale" });

export interface ResolveViewerReliabilityStateInput {
  readonly scene: SolarScene3D | null;
  readonly source: ViewerSceneSource;
  readonly generation: number;
  readonly renderedGeneration?: number | null;
  readonly officialBuildStatus?: "SUCCESS" | "FAILED" | "UNKNOWN";
  readonly officialBuildError?: ViewerOfficialBuildError | null;
  readonly fallbackAttempted?: boolean;
  readonly fallbackSucceeded?: boolean;
  readonly lastKnownGoodGeneration?: number | null;
  readonly stale?: boolean;
}

function issueText(code: ViewerReliabilityIssueCode): string {
  switch (code) {
    case "GEOMETRY_INVALID":
      return "La géométrie officielle est invalide.";
    case "OFFICIAL_BUILD_FAILED":
      return "Le pipeline 3D officiel a échoué.";
    case "EMERGENCY_FALLBACK_ACTIVE":
      return "La vue 3D affichée vient du mode de secours.";
    case "RENDER_ERROR":
      return "Le rendu React/Three a échoué.";
    case "STALE_SCENE":
      return "La vue 3D affichée ne correspond pas à la dernière modification.";
    case "DEGRADED_GEOMETRY":
      return "La géométrie contient des approximations identifiées.";
    case "PV_PLACEMENT_INVALID":
      return "Au moins un panneau PV n'est plus positionné de manière fiable.";
    case "UNAVAILABLE":
      return "La vue 3D n'est pas disponible.";
  }
}

function messageForKind(kind: ViewerReliabilityState["kind"]): string | null {
  switch (kind) {
    case "ready":
      return null;
    case "degraded":
      return "Vue 3D partiellement dégradée : certaines géométries reposent sur des approximations.";
    case "fallback":
      return "Vue 3D de secours : certaines informations peuvent ne pas correspondre exactement au calpinage.";
    case "invalid":
      return "Impossible de garantir la cohérence de cette vue 3D.";
    case "error":
      return "La vue 3D n'a pas pu être générée.";
    case "stale":
      return "La 3D affichée n'est plus synchronisée avec la dernière modification.";
  }
}

function diagnosticsFromScene(scene: SolarScene3D | null): GeometryDiagnostic[] {
  if (!scene) return [];
  return scene.roofModel.roofPlanePatches.flatMap((patch) => patch.quality?.diagnostics ?? []);
}

export function normalizeViewerOfficialBuildError(error: unknown, diagnostics?: unknown): ViewerOfficialBuildError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(import.meta.env.DEV && error.stack ? { stack: error.stack } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    };
  }
  return {
    message: typeof error === "string" ? error : String(error ?? "Erreur inconnue"),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function resolveViewerReliabilityState(input: ResolveViewerReliabilityStateInput): ViewerReliabilityState {
  const scene = input.scene;
  const geometryTruthStatus = scene?.metadata.geometryTruthStatus ?? "UNKNOWN";
  const invalidPatchCount = scene?.metadata.geometryTruthInvalidPatchCount ?? 0;
  const degradedPatchCount = scene?.metadata.geometryTruthDegradedPatchCount ?? 0;
  const renderedGeneration = input.renderedGeneration ?? (scene ? input.generation : null);
  const stale =
    input.stale === true ||
    (renderedGeneration != null && renderedGeneration !== input.generation);
  const fallbackAttempted = input.fallbackAttempted === true || input.source === "EMERGENCY_FALLBACK";
  const fallbackSucceeded = input.fallbackSucceeded === true || input.source === "EMERGENCY_FALLBACK";
  const officialBuildStatus = input.officialBuildStatus ?? (input.source === "OFFICIAL" && scene ? "SUCCESS" : "UNKNOWN");
  const issueCodes: ViewerReliabilityIssueCode[] = [];

  if (!scene || input.source === "UNAVAILABLE") issueCodes.push("UNAVAILABLE");
  if (officialBuildStatus === "FAILED") issueCodes.push("OFFICIAL_BUILD_FAILED");
  if (input.source === "EMERGENCY_FALLBACK") issueCodes.push("EMERGENCY_FALLBACK_ACTIVE");
  if (geometryTruthStatus === "INVALID") issueCodes.push("GEOMETRY_INVALID");
  if (geometryTruthStatus === "DEGRADED") issueCodes.push("DEGRADED_GEOMETRY");
  if (scene?.metadata.pvPlacementValidityStatus === "INVALID") issueCodes.push("PV_PLACEMENT_INVALID");
  if (stale) issueCodes.push("STALE_SCENE");

  let kind: ViewerReliabilityState["kind"] = "ready";
  if (!scene || input.source === "UNAVAILABLE") kind = "error";
  else if (stale) kind = "stale";
  else if (geometryTruthStatus === "INVALID" || scene.metadata.pvPlacementValidityStatus === "INVALID") kind = "invalid";
  else if (input.source === "EMERGENCY_FALLBACK") kind = "fallback";
  else if (geometryTruthStatus === "DEGRADED") kind = "degraded";

  const state: ViewerReliabilityState = {
    kind,
    generation: input.generation,
    renderedGeneration,
    source: input.source,
    geometryTruthStatus,
    officialBuildStatus,
    officialBuildError: input.officialBuildError ?? null,
    fallbackAttempted,
    fallbackSucceeded,
    stale,
    invalidPatchCount,
    degradedPatchCount,
    lastKnownGoodGeneration: input.lastKnownGoodGeneration ?? null,
    issueCodes,
    userMessage: messageForKind(kind),
    technicalDetails: issueCodes.map(issueText),
    diagnostics: diagnosticsFromScene(scene),
  };

  assertViewerReliabilityInvariants(state);
  return state;
}

export function assertViewerReliabilityInvariants(state: ViewerReliabilityState): void {
  if (state.source === "EMERGENCY_FALLBACK" && state.kind === "ready") {
    throw new Error("[3D-Reliability] Emergency fallback cannot be READY/VALID.");
  }
  if (state.geometryTruthStatus === "INVALID" && state.kind === "ready") {
    throw new Error("[3D-Reliability] INVALID geometry cannot be READY.");
  }
  if (state.renderedGeneration != null && state.renderedGeneration !== state.generation && !state.stale) {
    throw new Error("[3D-Reliability] Generation mismatch must be marked stale.");
  }
  if (state.officialBuildStatus === "FAILED" && state.fallbackSucceeded && state.officialBuildError == null) {
    throw new Error("[3D-Reliability] Official failure must remain accessible after fallback success.");
  }
}

export function exposeViewerReliabilityDiagnostics(
  state: ViewerReliabilityState,
  target: unknown = typeof window !== "undefined" ? window : undefined,
): void {
  if (!target || typeof target !== "object") return;
  (target as Record<string, unknown>)["__CALPINAGE_3D_RELIABILITY__"] = {
    snapshot: () => state,
  };
}
