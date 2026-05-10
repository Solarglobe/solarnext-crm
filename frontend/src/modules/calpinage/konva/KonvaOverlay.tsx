/**
 * KonvaOverlay — Stage Konva superposé au canvas legacy calpinage.
 *
 * Architecture P4.0 v2 — portal dans containerRef :
 *   - createPortal dans containerRef.current (sibling de #calpinage-root)
 *     → même stacking context, z-index propre sans ambiguïté cross-DOM
 *   - Stage dimensionné sur #calpinage-canvas-el (source de vérité exacte)
 *   - pointer-events: none total (P4.3 lèvera cette restriction par couche)
 *   - WorldGroup : image-space → écran-space (flip Y identique au canvas legacy)
 *     x=offsetX, y=offsetY, scaleX=scale, scaleY=-scale
 *
 * Pourquoi portal dans containerRef et non sibling React :
 *   Le legacy injecte #calpinage-root (position:relative z-index:1) dans containerRef.
 *   Un sibling React hors containerRef peut avoir un comportement de stacking context
 *   ambigu selon le navigateur. En portaling dans containerRef, on garantit que la
 *   div overlay (z-index:5) est bien au-dessus de #calpinage-root (z-index:1) dans le
 *   stacking context du parent, sans dépendre du layout flex de l'outer wrapper.
 *
 * Risque legacy : le legacy append uniquement (#calpinage-root), ne vide jamais containerRef.
 *   Le portal reste stable pendant toute la durée de vie du composant.
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

// ─────────────────────────────────────────────────────────────────────────────
// Debug alignment rect (dev uniquement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rectangle de référence en image-space (coin haut-gauche = 0,0).
 * Visible uniquement en dev avec flag actif.
 * Doit coïncider avec le coin bas-gauche (image-space Y=0 = bas de l'image sur écran)
 * du canvas legacy → valide le flip Y et l'alignement pixel.
 */
function DebugAlignRect() {
  // Visible dès que le flag Konva est actif (pas limité à DEV — sert à valider P4.0 en prod aussi)
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
        /* Coordonnées dans le stacking context du conteneur positionné parent.
         * containerRef n'a pas de position → le nearest positioned ancestor est
         * l'outer wrapper (position: relative). inset:0 couvre donc tout l'outer wrapper,
         * ce qui est identique à la zone du canvas legacy. */
        inset: 0,
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
