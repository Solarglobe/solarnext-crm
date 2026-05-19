/**
 * Handler MOVE_PV_PANEL — traduit la commande en appels legacy.
 *
 * Responsabilités :
 *   1. Commit le déplacement PV en cours via `finalizePvMoveFrom3d` (bridge legacy IIFE).
 *   2. Émet l'événement `calpinage:state-changed` pour déclencher la synchronisation Zustand
 *      côté listeners (ex. legacyCalpinageStateAdapter).
 *
 * Ce handler est temporaire (pattern Strangler Fig) : quand pvLayoutEngine sera extrait
 * en module TypeScript pur, il appellera directement `pvLayoutEngine.movePanel(...)`.
 *
 * PÉRIMÈTRE : ne pas toucher la logique de drag (usePvPanelDrag), ni le store Zustand
 * directement — la sync passe exclusivement par l'événement DOM.
 */

import { finalizePvMoveFrom3d } from "../../runtime/pvPlacement3dProduct";
import type { ExtractCommand } from "../commandTypes";

// ── Constante événement ───────────────────────────────────────────────────────

/**
 * Nom de l'événement CustomEvent émis après chaque mutation d'état Calpinage.
 * Consommé par `legacyCalpinageStateAdapter` pour synchroniser le store Zustand.
 */
export const CALPINAGE_STATE_CHANGED_EVENT = "calpinage:state-changed" as const;

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handler synchrone pour la commande MOVE_PV_PANEL.
 *
 * Appelé automatiquement par le CommandBus quand `dispatch({ type: "MOVE_PV_PANEL", ... })`.
 * Compatible avec la signature `CalpinageCommandHandler` via le guard de type dans le subscriber.
 *
 * @param cmd - Commande typée MOVE_PV_PANEL (panelId, newBlockId, deltaWorld).
 */
export function movePvPanelHandler(
  cmd: ExtractCommand<"MOVE_PV_PANEL">,
): void {
  // Étape 1 — commit la manipulation PV en cours dans le runtime legacy.
  // `finalizePvMoveFrom3d` lit l'état interne du moteur (blockId, positions) — pas besoin
  // de passer panelId/deltaWorld (ils sont dans le runtime IIFE).
  // pointerId: null = pas de pointer capture à relâcher (déjà fait par PvLayout3dDragController).
  finalizePvMoveFrom3d({ pointerId: null, releaseCaptureEl: null });

  // Étape 2 — signal de changement d'état pour synchronisation Zustand.
  // L'event est consommé par legacyCalpinageStateAdapter et tout listener externe.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(CALPINAGE_STATE_CHANGED_EVENT, {
        detail: {
          type: "MOVE_PV_PANEL",
          panelId: cmd.panelId,
          newBlockId: cmd.newBlockId,
        },
        bubbles: false,
      }),
    );
  }
}
