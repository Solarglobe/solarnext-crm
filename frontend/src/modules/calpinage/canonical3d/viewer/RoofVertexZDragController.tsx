/**
 * Drag Z sur le marqueur sommet : même logique métier que le curseur « réglage fin » de l’overlay —
 * à chaque mouvement utile, le parent enregistre la hauteur (`onLiveHeightM` → `onRoofVertexHeightCommit`).
 * Commit au pointerup supprimé (déjà appliqué en direct).
 *
 * Écouteurs `pointermove` / `up` montés une seule fois (`useLayoutEffect`) ; `invalidate()` redraw R3F.
 */

import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import { useThree } from "@react-three/fiber";
import { worldZFromPointerOnVerticalThroughXY } from "./roofVertexVerticalPointerMath";

export type RoofZDragSession = {
  readonly panId: string;
  readonly vertexIndex: number;
  readonly anchorXM: number;
  readonly anchorYM: number;
  /** Hauteur métier (m) au début du geste. */
  readonly heightMStart: number;
  /** Z monde sur le rayon au pointerdown — ancre pour Δh (null si vue dégénérée). */
  readonly rayZBaseline: number | null;
  /** Raycast XY→Z non fiable : tout le geste en delta écran. */
  readonly useScreenOnly: boolean;
  readonly startClientY: number;
  readonly pointerId: number;
  readonly minM: number;
  readonly maxM: number;
};

type Props = {
  readonly session: RoofZDragSession | null;
  /**
   * Réf alimentée au `pointerdown` **avant** le re-render React — évite de rater le premier `pointermove`.
   * Prioritaire sur `session` pour les écouteurs natifs.
   */
  readonly gestureSessionRef?: MutableRefObject<RoofZDragSession | null>;
  /** Vue plan : fallback écran privilégié (rayon ~ vertical). */
  readonly plan2dMode: boolean;
  readonly sceneMaxDim: number;
  /** Chaque hauteur clampée pendant le geste — même chemin que le slider overlay. */
  readonly onLiveHeightM: (z: number) => void;
  readonly onSessionEnd: () => void;
};

export function RoofVertexZDragController({
  session,
  gestureSessionRef,
  plan2dMode,
  sceneMaxDim,
  onLiveHeightM,
  onSessionEnd,
}: Props) {
  const { gl, camera, size, invalidate } = useThree();
  const sessionRef = useRef<RoofZDragSession | null>(null);
  sessionRef.current = session;
  const firstUsefulMoveLoggedRef = useRef(false);
  const liveHeightRef = useRef(onLiveHeightM);
  liveHeightRef.current = onLiveHeightM;
  const endRef = useRef(onSessionEnd);
  endRef.current = onSessionEnd;
  const lastZRef = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const plan2dRef = useRef(plan2dMode);
  plan2dRef.current = plan2dMode;
  const sceneMaxDimRef = useRef(sceneMaxDim);
  sceneMaxDimRef.current = sceneMaxDim;
  const sizeHeightRef = useRef(size.height);
  sizeHeightRef.current = size.height;

  useLayoutEffect(() => {
    if (session) {
      lastZRef.current = session.heightMStart;
      firstUsefulMoveLoggedRef.current = false;
    } else {
      lastZRef.current = null;
      firstUsefulMoveLoggedRef.current = false;
    }
  }, [session]);

  useLayoutEffect(() => {
    const el = gl.domElement;

    const activeSession = (): RoofZDragSession | null =>
      gestureSessionRef?.current ?? sessionRef.current;

    const onMove = (ev: PointerEvent) => {
      const s = activeSession();
      if (!s || ev.pointerId !== s.pointerId) return;
      const rect = el.getBoundingClientRect();
      const metersPerPixelY =
        (Math.max(sceneMaxDimRef.current, 1) / Math.max(sizeHeightRef.current, 1)) *
        (plan2dRef.current ? 0.14 : 0.12);
      let heightM: number;
      if (s.useScreenOnly) {
        heightM = s.heightMStart - (ev.clientY - s.startClientY) * metersPerPixelY;
      } else {
        const zNow = worldZFromPointerOnVerticalThroughXY(
          cameraRef.current,
          ev.clientX,
          ev.clientY,
          rect,
          s.anchorXM,
          s.anchorYM,
        );
        if (s.rayZBaseline != null && Number.isFinite(zNow)) {
          heightM = s.heightMStart + (zNow - s.rayZBaseline);
        } else {
          heightM = s.heightMStart - (ev.clientY - s.startClientY) * metersPerPixelY;
        }
      }
      const clamped = Math.min(s.maxM, Math.max(s.minM, heightM));
      const prev = lastZRef.current;
      if (prev != null && Math.abs(prev - clamped) < 1e-9) return;
      lastZRef.current = clamped;
      if (import.meta.env.DEV && !firstUsefulMoveLoggedRef.current) {
        firstUsefulMoveLoggedRef.current = true;
        console.log("[3D DRAG] live height (same path as overlay slider)", {
          nextHeight: clamped,
          delta: clamped - s.heightMStart,
        });
      }
      liveHeightRef.current(clamped);
      invalidate();
    };

    const onUp = (ev: PointerEvent) => {
      const s = activeSession();
      if (!s || ev.pointerId !== s.pointerId) return;
      try {
        el.releasePointerCapture(s.pointerId);
      } catch {
        /* déjà relâché */
      }
      const finalZ = lastZRef.current ?? s.heightMStart;
      if (import.meta.env.DEV) {
        console.log("[3D DRAG] end", { finalHeight: finalZ });
      }
      lastZRef.current = null;
      endRef.current();
      invalidate();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [gl, invalidate]);

  return null;
}
