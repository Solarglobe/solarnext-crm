/**
 * usePvPanelDrag — session de déplacement / rotation d'un bloc PV en mode 3D.
 *
 * Problème résolu — race condition du double-pattern useState + useRef + useEffect :
 *   // ❌ ANCIEN anti-pattern
 *   const [pv3dDragSession, setPv3dDragSession] = useState<PvLayout3dDragSession | null>(null);
 *   const pv3dDragSessionRef = useRef<PvLayout3dDragSession | null>(null);
 *   useEffect(() => { pv3dDragSessionRef.current = pv3dDragSession; }, [pv3dDragSession]);
 *   // ^ useEffect est ASYNC : ref stale entre setPv3dDragSession(...) et le prochain render.
 *   //   Un pointerMove/Up arrivant dans cet intervalle lit une valeur obsolète → drag figé.
 *
 * Solution — architecture ref-first :
 *   - `sessionRef` est mis à jour SYNCHRONEMENT dans `begin` / `end`, avant setSession.
 *   - Les handlers DOM/Three qui s'exécutent hors cycle React lisent toujours la valeur courante.
 *   - `session` (state) reste nécessaire pour :
 *       • Gate JSX `pv3dDragSession ? <PvLayout3dDragController>` (mount/unmount du composant)
 *       • Deps de useEffect qui réagissent aux transitions null ↔ non-null de la session.
 *
 * Garanties :
 *   1. sessionRef.current est toujours ≥ session (jamais en retard).
 *   2. Aucun state Zustand mis à jour pendant le drag — seulement en fin via le caller.
 *   3. begin / end sont stables (useCallback sans deps) — pas de recréation de closures.
 */

import { useState, useRef, useCallback } from "react";
import type { PvLayout3dDragSession } from "./PvLayout3dDragController";

export type { PvLayout3dDragSession };

export interface UsePvPanelDragReturn {
  /** State React — pour le gate JSX et les deps useEffect. */
  readonly session: PvLayout3dDragSession | null;
  /** Ref synchrone — pour les handlers DOM/Three hors cycle React. */
  readonly sessionRef: React.MutableRefObject<PvLayout3dDragSession | null>;
  /** Démarre une session de drag. Met à jour le ref AVANT le state. */
  readonly begin: (s: PvLayout3dDragSession) => void;
  /** Termine la session de drag. Met à jour le ref AVANT le state. */
  readonly end: () => void;
}

export function usePvPanelDrag(): UsePvPanelDragReturn {
  const [session, setSession] = useState<PvLayout3dDragSession | null>(null);
  const sessionRef = useRef<PvLayout3dDragSession | null>(null);

  const begin = useCallback((s: PvLayout3dDragSession) => {
    sessionRef.current = s; // synchrone : handlers peuvent lire immédiatement
    setSession(s);          // async React : monte <PvLayout3dDragController>
  }, []);

  const end = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
  }, []);

  return { session, sessionRef, begin, end };
}
