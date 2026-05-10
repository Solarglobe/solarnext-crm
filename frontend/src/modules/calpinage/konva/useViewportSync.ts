/**
 * Synchronise le viewport Konva avec le renderer legacy.
 *
 * Le renderer legacy (calpinage.module.js) expose :
 *   window.CALPINAGE_VIEWPORT_SCALE  — zoom courant
 *   window.CALPINAGE_VIEWPORT_OFFSET — { x, y } offset canvas (mis à jour à chaque renderImpl)
 *
 * Il dispatch également l'événement DOM "calpinage:viewport-changed" à chaque frame rendue,
 * avec detail: { scale, offsetX, offsetY }.
 *
 * Ce hook écoute cet événement et retourne l'état courant du viewport.
 * La valeur initiale est lue depuis les globals window si déjà disponibles.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type KonvaViewport = {
  /** vp.scale du renderer legacy. */
  readonly scale: number;
  /** vp.offset.x — translation X canvas→écran. */
  readonly offsetX: number;
  /** vp.offset.y — translation Y canvas→écran (axe Y inversé dans le canvas legacy). */
  readonly offsetY: number;
  /** Largeur CSS du container en pixels (via ResizeObserver). */
  readonly width: number;
  /** Hauteur CSS du container en pixels (via ResizeObserver). */
  readonly height: number;
};

const VIEWPORT_EVENT = "calpinage:viewport-changed";

type ViewportEventDetail = { scale: number; offsetX: number; offsetY: number };

function readWindowViewport(): Pick<KonvaViewport, "scale" | "offsetX" | "offsetY"> {
  if (typeof window === "undefined") return { scale: 1, offsetX: 0, offsetY: 0 };
  const w = window as unknown as Record<string, unknown>;
  const scale = typeof w["CALPINAGE_VIEWPORT_SCALE"] === "number"
    ? (w["CALPINAGE_VIEWPORT_SCALE"] as number)
    : 1;
  const off = w["CALPINAGE_VIEWPORT_OFFSET"] as { x?: number; y?: number } | undefined;
  return {
    scale,
    offsetX: typeof off?.x === "number" ? off.x : 0,
    offsetY: typeof off?.y === "number" ? off.y : 0,
  };
}

/**
 * Hook à monter dans KonvaOverlay.
 * @param containerEl — l'élément dont les dimensions définissent la taille du Stage.
 */
export function useViewportSync(containerEl: HTMLElement | null): KonvaViewport {
  const [vp, setVp] = useState<KonvaViewport>(() => ({
    ...readWindowViewport(),
    width: containerEl?.offsetWidth ?? 0,
    height: containerEl?.offsetHeight ?? 0,
  }));

  /* Écoute viewport-changed pour scale + offset */
  const onViewportChanged = useCallback((e: Event) => {
    const d = (e as CustomEvent<ViewportEventDetail>).detail;
    if (!d) return;
    setVp((prev) => ({
      ...prev,
      scale: d.scale,
      offsetX: d.offsetX,
      offsetY: d.offsetY,
    }));
  }, []);

  useEffect(() => {
    window.addEventListener(VIEWPORT_EVENT, onViewportChanged);
    /* Sync immédiate si le renderer a déjà tourné avant le montage du hook */
    setVp((prev) => ({
      ...prev,
      ...readWindowViewport(),
    }));
    return () => window.removeEventListener(VIEWPORT_EVENT, onViewportChanged);
  }, [onViewportChanged]);

  /* ResizeObserver pour les dimensions du container */
  const roRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (!containerEl) return;
    const updateSize = () => {
      const w = containerEl.offsetWidth;
      const h = containerEl.offsetHeight;
      if (w > 0 && h > 0) {
        setVp((prev) => {
          if (prev.width === w && prev.height === h) return prev;
          return { ...prev, width: w, height: h };
        });
      }
    };
    updateSize();
    roRef.current = new ResizeObserver(updateSize);
    roRef.current.observe(containerEl);
    return () => {
      roRef.current?.disconnect();
      roRef.current = null;
    };
  }, [containerEl]);

  return vp;
}
