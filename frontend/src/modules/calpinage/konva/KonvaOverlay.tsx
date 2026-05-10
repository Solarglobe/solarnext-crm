/**
 * KonvaOverlay — Stage Konva superposé au canvas legacy calpinage.
 *
 * Architecture P4.0 (infrastructure uniquement) :
 *   - Stage positionné en `position: absolute; inset: 0` sur le même container que le canvas legacy
 *   - pointer-events: none — toutes les interactions restent sur le canvas legacy
 *   - WorldGroup : transforme les coordonnées image-space vers écran-space
 *     x=offsetX, y=offsetY, scaleX=scale, scaleY=-scale  (flip Y identique au canvas legacy)
 *   - En dev avec flag actif : DebugAlignRect dessine un rectangle de référence
 *     pour vérifier l'alignement visuel avec le canvas legacy
 *
 * Invariants :
 *   - pointer-events: none sur tout le Stage (P4.3 lèvera cette restriction par couche)
 *   - Aucun dessin métier ici — les couches P4.1+ sont injectées via children ou composition
 *   - Zéro impact si isKonvaOverlayEnabled() === false (composant non monté)
 *
 * Convention coordonnées :
 *   ctx.transform(s, 0, 0, -s, ox, oy) legacy  ≡  WorldGroup x=ox y=oy scaleX=s scaleY=-s Konva
 *   → toutes les formes dans WorldGroup utilisent les coordonnées image-space directement.
 *   → les Text Konva dans WorldGroup nécessitent scaleY(-1) local pour ne pas être inversés.
 *
 * @see docs/architecture/phase4-konva-migration.md
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import { Layer, Group, Rect, Stage, Text } from "react-konva";
import { useViewportSync } from "./useViewportSync";

const IS_DEV = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

// ─────────────────────────────────────────────────────────────────────────────
// Debug alignment rect (dev uniquement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rectangle de référence en image-space (coin haut-gauche = 0,0).
 * En dev, doit coïncider avec le coin image du canvas legacy pour valider l'alignement.
 */
function DebugAlignRect() {
  if (!IS_DEV) return null;
  return (
    <>
      {/* Bordure image entière */}
      <Rect
        x={0}
        y={0}
        width={100}
        height={100}
        stroke="rgba(255,0,200,0.8)"
        strokeWidth={2}
        fill="rgba(255,0,200,0.08)"
        dash={[6, 4]}
        listening={false}
      />
      {/* Coin haut-gauche */}
      <Rect
        x={0}
        y={0}
        width={12}
        height={12}
        fill="rgba(255,0,200,0.6)"
        listening={false}
      />
      {/* Label — scaleY=-1 pour compenser le flip Y du WorldGroup */}
      <Text
        x={14}
        y={-2}
        text="Konva P4.0 debug"
        fontSize={12}
        fill="rgba(255,0,200,1)"
        scaleY={-1}
        listening={false}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KonvaOverlay
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  /** Ref du container legacy — le Stage se superpose exactement à cet élément. */
  containerRef: RefObject<HTMLDivElement | null>;
};

export function KonvaOverlay({ containerRef }: Props) {
  const containerEl = containerRef.current ?? null;
  const vp = useViewportSync(containerEl);

  // Expose les couches Konva actives pour le kill switch legacy (P4.1+)
  useEffect(() => {
    const w = window as unknown as { __CALPINAGE_KONVA_LAYERS__?: Set<string> };
    w.__CALPINAGE_KONVA_LAYERS__ = new Set<string>();
    return () => {
      delete w.__CALPINAGE_KONVA_LAYERS__;
    };
  }, []);

  if (vp.width === 0 || vp.height === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        /* Au-dessus du canvas legacy, sous les sidebars et UI */
        zIndex: 5,
      }}
    >
      <Stage
        width={vp.width}
        height={vp.height}
        style={{ display: "block" }}
        listening={false}
      >
        <Layer listening={false} clearBeforeDraw={true}>
          {/*
           * WorldGroup — coordonnées image-space → écran-space.
           * Même transformation que ctx.transform(s, 0, 0, -s, ox, oy) du canvas legacy.
           */}
          <Group
            x={vp.offsetX}
            y={vp.offsetY}
            scaleX={vp.scale}
            scaleY={-vp.scale}
          >
            {IS_DEV && <DebugAlignRect />}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}

export default KonvaOverlay;
