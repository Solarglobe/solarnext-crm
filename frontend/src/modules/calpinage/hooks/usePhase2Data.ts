/**
 * usePhase2Data — Hook lecture seule pour sidebar Phase 2 (Relevé toiture).
 *
 * Phase 1 : lit depuis calpinageStore (Zustand) au lieu de window.*.
 * L'adapter legacyCalpinageStateAdapter.ts se charge de lire window.getPhase2Data()
 * et de mettre à jour le store sur chaque événement "phase2:update".
 *
 * Le hook est devenu un simple selector Zustand — aucun accès window.*.
 */
import { useCalpinageStore } from "../store/calpinageStore";
import type { CalpinageStore } from "../store/storeTypes";

export function usePhase2Data() {
  return useCalpinageStore((s: CalpinageStore) => s.phase2);
}

/**
 * Exposé sur window pour que le legacy puisse notifier les mises à jour.
 * Retourne la fn assignée pour cleanup (appelé par Phase2Sidebar).
 *
 * L'événement "phase2:update" déclenche le re-read dans l'adapter,
 * qui met à jour le store, ce qui re-rend les composants abonnés via Zustand.
 */
export function setupPhase2SidebarNotify(): () => void {
  const fn = () => window.dispatchEvent(new Event("phase2:update"));
  (window as unknown as Record<string, unknown>).notifyPhase2SidebarUpdate = fn;
  return fn;
}
