/**
 * KonvaPansLayer — P4.4 : hover + sélection des pans en Konva.
 *
 * Ce composant redessine les overlays hover et sélection des pans sur le Stage Konva,
 * et expose ses shapes dans le hit canvas pour que stage.getIntersection() fonctionne
 * (hit-test délégué depuis handlePointerOrMouseDown et pointermove legacy).
 *
 * État lu depuis les globales legacy à chaque calpinage:viewport-changed :
 *   - CALPINAGE_STATE.pans          → géométrie (points | polygon, image-space)
 *   - CALPINAGE_STATE.selectedPanId → pan sélectionné
 *   - window.CALPINAGE_HOVER_PAN_ID → pan survolé (exposé dans renderImpl P4.4)
 *
 * Convention coordonnées (WorldGroup x=ox y=oy scaleX=s scaleY=-s) :
 *   y_world = imgH - imgPt.y   (identique KonvaContoursLayer / KonvaObstaclesLayer)
 *
 * Rendu :
 *   Hover  (≠ sélectionné) : fill rgba(37,99,235,0.07)  + stroke rgba(37,99,235,0.62) 1.35px
 *   Sélection              : fill rgba(37,99,235,0.13)  (pas de stroke)
 *
 * Hit canvas :
 *   Chaque pan a une Line id="pan-{pan.id}" listening={true} → visible dans getIntersection.
 *   pointer-events reste none sur l'overlay div → aucun DOM event ne remonte ici.
 */

import { useEffect, useState } from "react";
import { Group, Line } from "react-konva";
import { resolveImgH } from "./resolveImgH";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImgPt = { x: number; y: number };

type Pan = {
  id: string;
  points?: ImgPt[];
  polygon?: ImgPt[];
};

type LayerSnap = {
  pans: Pan[];
  selectedPanId: string | null;
  hoverPanId: string | null;
  imgH: number;
};

// ─── Couleurs (identiques legacy, section 4a / section 4) ─────────────────────

const STYLE = {
  hoverFill:        "rgba(37, 99, 235, 0.07)",
  hoverStroke:      "rgba(37, 99, 235, 0.62)",
  hoverStrokeWidth: 1.35,
  selFill:          "rgba(37, 99, 235, 0.13)",
} as const;

const VIEWPORT_EVENT = "calpinage:viewport-changed";

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readLayerSnap(): LayerSnap | null {
  const w = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as
    | { pans?: Pan[]; selectedPanId?: string | null; roof?: { image?: { height?: number } } }
    | null
    | undefined;
  if (!st) return null;
  const imgH = resolveImgH();
  if (imgH === 0) return null;
  return {
    pans: Array.isArray(st.pans) ? st.pans : [],
    selectedPanId: st.selectedPanId ?? null,
    hoverPanId: (w["CALPINAGE_HOVER_PAN_ID"] as string | null | undefined) ?? null,
    imgH,
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function KonvaPansLayer() {
  const [snap, setSnap] = useState<LayerSnap | null>(null);

  /* Sync sur chaque frame legacy */
  useEffect(() => {
    const sync = () => {
      const s = readLayerSnap();
      if (s) setSnap(s);
    };
    sync();
    window.addEventListener(VIEWPORT_EVENT, sync);
    return () => window.removeEventListener(VIEWPORT_EVENT, sync);
  }, []);

  /* Kill switch — enregistrer la couche dans __CALPINAGE_KONVA_LAYERS__ */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const layers = w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined;
    layers?.add("pans");
    return () => {
      (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.delete("pans");
    };
  }, []);

  if (!snap) return null;

  const { pans, selectedPanId, hoverPanId, imgH } = snap;

  return (
    <>
      {pans.map((pan) => {
        /* Résolution polygon : points en priorité, sinon polygon */
        const poly =
          pan.points && pan.points.length >= 3
            ? pan.points
            : pan.polygon && pan.polygon.length >= 3
            ? pan.polygon
            : null;
        if (!poly) return null;

        /* Conversion image-space Y=0-at-top → world-space Y=0-at-bottom */
        const pts = poly.flatMap((p) => [p.x, imgH - p.y]);

        const isSel   = pan.id === selectedPanId;
        const isHover = pan.id === hoverPanId && !isSel;

        return (
          <Group key={pan.id} listening={false}>
            {/*
             * Shape hit-canvas : id="pan-{id}" + listening={true}
             * Utilisée par stage.getIntersection() pour __CALPINAGE_KONVA_PAN_HIT__ (P4.4).
             * Fill transparent → invisible visuellement, mais présente dans le hit canvas.
             */}
            <Line
              id={`pan-${pan.id}`}
              points={pts}
              closed
              fill="rgba(0,0,0,0)"
              stroke="transparent"
              strokeWidth={0}
              listening={true}
            />

            {/* Overlay hover (uniquement si ≠ sélectionné) */}
            {isHover && (
              <Line
                points={pts}
                closed
                fill={STYLE.hoverFill}
                stroke={STYLE.hoverStroke}
                strokeWidth={STYLE.hoverStrokeWidth}
                strokeScaleEnabled={false}
                lineJoin="round"
                listening={false}
              />
            )}

            {/* Overlay sélection */}
            {isSel && (
              <Line
                points={pts}
                closed
                fill={STYLE.selFill}
                stroke="transparent"
                strokeWidth={0}
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

export default KonvaPansLayer;
