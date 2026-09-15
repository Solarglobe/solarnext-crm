/**
 * Instantané lecture seule de l’ombrage tel qu’il vit dans le state calpinage (IIFE legacy).
 * Aucun recalcul — utilisé pour parité UI ↔ serveur (observation / POST optionnel sur /calc).
 */

import { getGlobalShadingLossPctForCalpinageShadingState } from "./officialGlobalShadingLoss";
import { getShadingAssessment } from "../../../../../shared/shading/shadingAssessment.js";

export type UiShadingSnapshot = {
  totalLossPct: number | null;
  assessment: ReturnType<typeof getShadingAssessment>;
  near: unknown;
  far: unknown;
  combined: unknown;
  perPanel: unknown[];
  source: string;
  computedAt: string | null;
  /** Raison d’abort moteur front si présente */
  lastAbortReason?: string | null;
};

type CalpinageWindow = Window & {
  CALPINAGE_STATE?: {
    shading?: {
      normalized?: Record<string, unknown> | null;
      lastResult?: { annualLossPercent?: number } | null;
      lastComputedAt?: number | null;
      lastAbortReason?: string | null;
    };
  };
};

/**
 * Lit CALPINAGE_STATE.shading — priorité `normalized` (contrat V2 affichage / export),
 * sinon repli minimal sur `lastResult.annualLossPercent`.
 */
export function getUiShadingSnapshot(): UiShadingSnapshot | null {
  if (typeof window === "undefined") return null;
  const state = (window as CalpinageWindow).CALPINAGE_STATE?.shading;
  if (!state || typeof state !== "object") return null;

  const normalized = state.normalized != null && typeof state.normalized === "object" ? state.normalized : null;
  const lr = state.lastResult != null && typeof state.lastResult === "object" ? state.lastResult : null;

  let source = "none";
  if (normalized) source = "normalized_v2";
  else if (lr && typeof lr.annualLossPercent === "number") source = "lastResult_annualLossPercent";

  const totalLossPct = getGlobalShadingLossPctForCalpinageShadingState(state);
  const assessment = state.lastAbortReason
    ? { ...getShadingAssessment(normalized), status: "error" as const }
    : getShadingAssessment(normalized);
  // Never revive a rejected normalized result from an old lastResult or root alias.
  const combined = normalized?.combined ?? null;

  const computedAt =
    typeof state.lastComputedAt === "number" && Number.isFinite(state.lastComputedAt)
      ? new Date(state.lastComputedAt).toISOString()
      : null;

  const perPanel = normalized && Array.isArray((normalized as { perPanel?: unknown[] }).perPanel)
    ? ([...(normalized as { perPanel: unknown[] }).perPanel] as unknown[])
    : [];

  return {
    totalLossPct,
    assessment,
    near: normalized?.near ?? null,
    far: normalized?.far ?? null,
    combined,
    perPanel,
    source,
    computedAt,
    lastAbortReason: state.lastAbortReason ?? null,
  };
}
