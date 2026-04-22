/**
 * Modes de lecture premium Maison 3D — orchestration rendu / hiérarchie visuelle (Prompt 10).
 * Aucune géométrie : uniquement des intentions d’affichage consommées par le viewer.
 */

export type PremiumHouse3DViewMode = "presentation" | "technical" | "validation" | "pv";

export const PREMIUM_HOUSE_3D_VIEW_MODES: readonly PremiumHouse3DViewMode[] = [
  "presentation",
  "technical",
  "validation",
  "pv",
];

export function isPremiumHouse3DViewMode(v: string | null | undefined): v is PremiumHouse3DViewMode {
  return v === "presentation" || v === "technical" || v === "validation" || v === "pv";
}
