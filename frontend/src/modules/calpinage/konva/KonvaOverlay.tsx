/**
 * KonvaOverlay — Stage Konva superposé au canvas legacy calpinage.
 *
 * Architecture P4.0 v3 — positionnement précis sur #calpinage-canvas-el :
 *   - Le legacy injecte #calpinage-root dans containerRef, qui contient
 *     la sidebar legacy + le canvas. inset:0 couvrirait toute la zone
 *     (sidebar incluse), décalant le Stage.
 *   - On calcule le delta getBoundingClientRect(canvas) - getBoundingClientRect(container)
 *     pour positionner l'overlay exactement sur le canvas element.
 *   - Stage dimensionné sur vp.width x vp.height (= canvasEl dimensions CSS).
 *   - pointer-events: none total (P4.3 lèvera cette restriction par couche)
 *   - WorldGroup : image-space → écran-space (flip Y identique au canvas legacy)
 *     x=offsetX, y=offsetY, scaleX=scale, scaleY=-scale
 *
 * Convention coordonnées :
 *   ctx.transform(s, 0, 0, -s, ox, oy) legacy ≡ WorldGroup x=ox y=oy scaleX=s scaleY=-s
 *   → formes dans WorldGroup : coordonnées image-space directement.
 *   → Text dans WorldGroup : nécessite scaleY(-1) local pour ne pas être inversé.
 */

import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Layer, Group, Rect, Stage, Text } from "react-konva";
import { useViewportSync } from "./useViewportSync";
import { KonvaContoursLayer } from "./KonvaContoursLayer";

// ─────────────────────────────────────────────────────────────────────────────
// Debug alignment rect
// ─────────────────────────────────────────────────────────────────────────────

function DebugAlignRect() {
  return (
    <>
      {/* Croix sur l'origine image (0,0) — coin bas-gauche sur écran */}
      <Rect x={-10} y={-10} width={20} height={20} fill="rgba(255,0,200,0.9)" listening={false} />
      {/* Rectangle de 200×200 px image depuis (0,0) */}
      <Rect
        x={0} y={0} width={200} height={200}
        stroke="rgba(255,0,200,0.85)" strokeWidth={3}
        fill="rgba(255,0,200,0.06)"
        dash={[8, 5]} listening={false}
      />
      {/* Label — scaleY=-1 pour compenser le flip Y du WorldGroup */}
      <Text
        x={5} y={-20} text="Konva P4.0 (0,0)" fontSize={14}
        fill="rgba(255,0,200,1)" scaleY={-1} fontStyle="bold" listening={false}
      />
      {/* Point (200,200) */}
      <Rect x={194} y={194} width={12} height={12} fill="rgba(255,0,200,0.9)" listening={false} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KonvaOverlay
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  /** Ref du container legacy — le portal s'ancre ici comme sibling de #calpinage-root. */
  containerRef: RefObject<HTMLDivElement | null>;
};

/** Offset du canvas par rapport au containerRef (en px CSS). */
type CanvasOffset = { left: number; top: number };

export function KonvaOverlay({ containerRef }: Props) {
  // Attendre que #calpinage-canvas-el existe (injecté de façon impérative par le legacy)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const tryFind = () => {
      const el = container.querySelector<HTMLCanvasElement>("#calpinage-canvas-el");
      if (el) {
        setCanvasEl(el);
        return true;
      }
      return false;
    };

    if (tryFind()) return;

    // Poll jusqu'à ce que le canvas legacy soit injecté
    const id = setInterval(() => {
      if (tryFind()) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [containerRef]);

  // Synchronise viewport depuis le renderer legacy
  const vp = useViewportSync(canvasEl);

  /**
   * Offset CSS du canvas dans le stacking context de containerRef.
   * Le legacy injecte sidebar + canvas dans containerRef, donc le canvas
   * ne commence pas nécessairement à (0,0) dans containerRef.
   * On calcule delta = getBoundingClientRect(canvas) - getBoundingClientRect(container).
   */
  const [canvasOffset, setCanvasOffset] = useState<CanvasOffset>({ left: 0, top: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!canvasEl || !container) return;

    const update = () => {
      const cr = canvasEl.getBoundingClientRect();
      const pr = container.getBoundingClientRect();
      const left = Math.round(cr.left - pr.left);
      const top = Math.round(cr.top - pr.top);
      setCanvasOffset((prev) =>
        prev.left === left && prev.top === top ? prev : { left, top }
      );
    };

    update();
    // Remettre à jour sur chaque frame legacy + resize
    window.addEventListener("calpinage:viewport-changed", update);
    const ro = new ResizeObserver(update);
    ro.observe(canvasEl);
    ro.observe(container);
    return () => {
      window.removeEventListener("calpinage:viewport-changed", update);
      ro.disconnect();
    };
  }, [canvasEl, containerRef]);

  // Expose les couches actives pour le kill switch legacy (P4.1+)
  useEffect(() => {
    const w = window as unknown as { __CALPINAGE_KONVA_LAYERS__?: Set<string> };
    w.__CALPINAGE_KONVA_LAYERS__ = new Set<string>();
    return () => {
      delete w.__CALPINAGE_KONVA_LAYERS__;
    };
  }, []);

  const container = containerRef.current;
  if (!container || !canvasEl || vp.width === 0 || vp.height === 0) return null;

  const overlay = (
    <div
      style={{
        position: "absolute",
        /* Positionné exactement sur #calpinage-canvas-el :
         * left/top = offset du canvas dans containerRef (hors sidebar legacy).
         * width/height = dimensions CSS du canvas. */
        left: canvasOffset.left,
        top: canvasOffset.top,
        width: vp.width,
        height: vp.height,
        pointerEvents: "none",
        /* Au-dessus de #calpinage-root (z-index:1), sous les UI overlay (z-index:50+) */
        zIndex: 5,
      }}
    >
      <Stage
        width={vp.width}
        height={vp.height}
        listening={false}
        style={{ display: "block" }}
      >
        <Layer listening={false} clearBeforeDraw>
          {/*
           * WorldGroup — coordonnées image-space → écran-space.
           * Identique à ctx.transform(s, 0, 0, -s, ox, oy) du canvas legacy.
           * Note : image-space (0,0) = coin BAS-GAUCHE sur écran (Y inversé).
           */}
          <Group
            x={vp.offsetX}
            y={vp.offsetY}
            scaleX={vp.scale}
            scaleY={-vp.scale}
          >
            <KonvaContoursLayer />
            <DebugAlignRect />
          </Group>
        </Layer>
      </Stage>
    </div>
  );

  // Portal dans containerRef : sibling de #calpinage-root dans le même stacking context
  return createPortal(overlay, container);
}

export default KonvaOverlay;
