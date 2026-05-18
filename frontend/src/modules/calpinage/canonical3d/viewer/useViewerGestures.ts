/**
 * useViewerGestures — gestion tactile unifiée pour SolarScene3DViewer.
 *
 * PROBLÈME : le viewer n'écoutait que les events souris (onMouseDown/Move/Up).
 * Sur iPad/iPhone : pinch-zoom non fonctionnel, tap ne sélectionnait pas.
 *
 * SOLUTION : Pointer Events API unifie souris + stylet + tactile.
 *   - onPointerDown/Move/Up sur le wrapper DOM capturent toutes les sources.
 *   - OrbitControls (@react-three/drei) reste le système de base pour pan/orbite.
 *   - Ce hook ajoute au-dessus : tap, pinch-to-zoom, gestion du double-déclenchement.
 *
 * COEXISTENCE souris/touch :
 *   Pointer Events sont déjà unifiés par le browser — chaque input génère
 *   exactement un flux de pointer events (pointerType = "mouse"|"touch"|"pen").
 *   Aucun double-déclenchement si on N'écoute PAS en parallèle mousedown/touchstart.
 *   → Remplacer onMouseDown/Move/Up par onPointerDown/Move/Up partout.
 *
 * GESTURES implémentées :
 *   1. tap    : 1 pointeur actif, durée < TAP_MAX_MS, δxy < TAP_MAX_DELTA_PX
 *              → onTap(nativeEvent) — déclenche le raycast de sélection R3F
 *   2. pinch  : 2 pointeurs simultanés → ratio des distances → dolly OrbitControls
 *              → preventDefault() pour bloquer le pinch-zoom natif du browser
 *   3. pan 1 doigt / orbite souris : délégué à OrbitControls (touch-action:none suffit)
 *
 * CONTRAINTE : OrbitControls ne doit PAS être désactivé pendant le pinch.
 *   On ajuste le zoom via `dollyIn / dollyOut` de l'instance OrbitControls,
 *   puis on laisse OrbitControls continuer à gérer l'état.
 *
 * USAGE :
 *   const { wrapperPointerProps } = useViewerGestures({ onTap, orbitControlsRef });
 *   <div {...wrapperPointerProps} style={{ touchAction: "none" }}>
 *     <Canvas .../>
 *   </div>
 *
 * REMARQUE : touch-action:none DOIT aussi être posé sur gl.domElement (le <canvas> WebGL)
 *   via onCreated → gl.domElement.style.touchAction = "none"
 *   sinon le browser intercepte les gestes avant que pointer events soient dispatché.
 */

import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Durée max (ms) d'un tap. Au-delà → interaction longue (drag, hold). */
const TAP_MAX_MS = 200;

/** Déplacement max (px) entre pointerdown et pointerup pour qu'un tap soit reconnu. */
const TAP_MAX_DELTA_PX = 5;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ActivePointer {
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  currentX: number;
  currentY: number;
}

/** Paramètres du hook. */
export interface UseViewerGesturesOptions {
  /**
   * Callback déclenché sur tap (< TAP_MAX_MS, δ < TAP_MAX_DELTA_PX).
   * Le raycast R3F est géré par le Canvas — ce callback est optionnel
   * (ex. logique supplémentaire : analytics, double-sélection…).
   */
  onTap?: (e: PointerEvent) => void;

  /**
   * Référence à l'instance OrbitControls (three-stdlib) pour le zoom pinch.
   * Si absent, le pinch n'ajuste pas le zoom (OrbitControls gère seul si touch-action:none).
   */
  orbitControlsRef?: MutableRefObject<OrbitControlsImpl | null>;
}

/** Handlers à passer sur le wrapper div autour du Canvas. */
export interface ViewerPointerHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
}

export interface UseViewerGesturesResult {
  /** Props à spreader sur le wrapper div (touch-action:none doit être dans son style). */
  wrapperPointerProps: ViewerPointerHandlers;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook de gestion unifiée des gestes (souris + tactile) pour le viewer 3D.
 *
 * À utiliser dans SolarScene3DViewer, sur le wrapper div autour de `<Canvas>`.
 */
export function useViewerGestures({
  onTap,
  orbitControlsRef,
}: UseViewerGesturesOptions = {}): UseViewerGesturesResult {
  /** Map pointerId → état du pointeur actif. */
  const pointersRef = useRef<Map<number, ActivePointer>>(new Map());
  /** Distance entre les deux pointeurs au début d'un pinch. */
  const pinchStartDistRef = useRef<number | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getPinchDistance = (): number | null => {
    const pts = [...pointersRef.current.values()];
    if (pts.length !== 2) return null;
    const [a, b] = pts as [ActivePointer, ActivePointer];
    const dx = a.currentX - b.currentX;
    const dy = a.currentY - b.currentY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  /**
   * Applique un ratio de dolly à OrbitControls.
   * ratio > 1 → zoom in (pinch ouverture)
   * ratio < 1 → zoom out (pinch fermeture)
   *
   * OrbitControls three-stdlib expose dollyIn / dollyOut (non typés publiquement).
   */
  const applyPinchDolly = (ratio: number): void => {
    const oc = orbitControlsRef?.current;
    if (!oc) return;
    // Cast : OrbitControls three-stdlib possède ces méthodes mais elles ne sont pas
    // dans les types publics @types.
    const ocAny = oc as unknown as {
      dollyIn?: (scale: number) => void;
      dollyOut?: (scale: number) => void;
      update?: () => void;
    };
    if (ratio > 1 && typeof ocAny.dollyIn === "function") {
      ocAny.dollyIn(ratio);
    } else if (ratio < 1 && typeof ocAny.dollyOut === "function") {
      ocAny.dollyOut(1 / ratio);
    }
    if (typeof ocAny.update === "function") ocAny.update();
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    pointersRef.current.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      currentX: e.clientX,
      currentY: e.clientY,
    });

    // Début de pinch : 2ème pointeur vient de descendre
    if (pointersRef.current.size === 2) {
      pinchStartDistRef.current = getPinchDistance();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const ptr = pointersRef.current.get(e.pointerId);
    if (!ptr) return;
    ptr.currentX = e.clientX;
    ptr.currentY = e.clientY;

    // Gestion pinch-to-zoom (2 pointeurs)
    if (pointersRef.current.size === 2 && pinchStartDistRef.current != null) {
      const currentDist = getPinchDistance();
      if (currentDist != null && pinchStartDistRef.current > 0) {
        const ratio = currentDist / pinchStartDistRef.current;
        applyPinchDolly(ratio);
        // Mise à jour de la référence pour le prochain move (delta incrémental)
        pinchStartDistRef.current = currentDist;
        // Empêche le pinch-zoom natif du browser
        e.preventDefault?.();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finalizePointer = useCallback(
    (e: React.PointerEvent<HTMLElement>, cancelled = false) => {
      const ptr = pointersRef.current.get(e.pointerId);
      if (!ptr) return;

      if (!cancelled) {
        const duration = performance.now() - ptr.startTime;
        const dx = e.clientX - ptr.startX;
        const dy = e.clientY - ptr.startY;
        const delta = Math.sqrt(dx * dx + dy * dy);

        // Tap reconnu : durée courte + faible déplacement + 1 seul pointeur actif
        if (
          duration < TAP_MAX_MS &&
          delta < TAP_MAX_DELTA_PX &&
          pointersRef.current.size === 1 &&
          typeof onTap === "function"
        ) {
          onTap(e.nativeEvent);
        }
      }

      pointersRef.current.delete(e.pointerId);

      // Reset pinch si moins de 2 pointeurs
      if (pointersRef.current.size < 2) {
        pinchStartDistRef.current = null;
      }
    },
    [onTap],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => finalizePointer(e, false),
    [finalizePointer],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => finalizePointer(e, true),
    [finalizePointer],
  );

  return {
    wrapperPointerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
