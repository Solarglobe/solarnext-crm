/**
 * KonvaContoursLayer — P4.1 shadow layer : contours + faîtages/ridges.
 *
 * Shadow layer : le legacy continue de dessiner les mêmes formes sur le canvas.
 * Ce composant les redessine sur le Stage Konva pour valider l'alignement pixel.
 * Une fois validé, P4.2 désactivera le rendu legacy correspondant.
 *
 * Convention coordonnées (WorldGroup x=ox y=oy scaleX=s scaleY=-s) :
 *   world.y = imgH - imgPt.y   (imageToScreen fait la même conversion)
 *   → y_konva = imgH - pt.y pour les points image-space Y=0-at-top.
 *
 * Synchronisation : écoute "calpinage:viewport-changed" (dispatché par renderImpl
 * à chaque frame) — garantit que l'état Konva est à jour après chaque rendu legacy.
 *
 * strokeScaleEnabled={false} : largeurs de trait fixes en pixels écran, identique
 * au comportement legacy (ctx.lineWidth en px indépendant du zoom).
 */

import { useEffect, useState } from "react";
import { Group, Line } from "react-konva";
import { resolveImgH } from "./resolveImgH";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImgPt = { x: number; y: number };

type Contour = {
  id: string;
  points: ImgPt[];
  closed: boolean;
  roofRole: string;
};

type Ridge = {
  id: string;
  a: ImgPt;
  b: ImgPt;
  roofRole: string;
};

type LayerSnap = {
  contours: Contour[];
  ridges: Ridge[];
  imgH: number;
};

// ─── Couleurs (PHASE2_DRAW_STYLE du legacy) ───────────────────────────────────

const STYLE = {
  /* Contour bâti */
  roofHalo: "rgba(255, 255, 255, 0.90)",
  roofStroke: "#2563eb",
  roofFill: "rgba(37, 99, 235, 0.06)",
  roofHaloWidth: 4.0,
  roofStrokeWidth: 1.8,
  /* Faîtage */
  ridgeHalo: "rgba(255, 255, 255, 0.85)",
  ridgeStroke: "#d97706",
  ridgeHaloWidth: 4.0,
  ridgeStrokeWidth: 2.0,
} as const;

const VIEWPORT_EVENT = "calpinage:viewport-changed";

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readLayerSnap(): LayerSnap | null {
  const w = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as
    | { contours?: Contour[]; ridges?: Ridge[]; roof?: { image?: { height?: number } } }
    | null
    | undefined;
  if (!st) return null;
  // imgH = hauteur de l'image SOURCE (roofImg), pas du canvas HTML.
  // Le legacy utilise CALPINAGE_STATE.roof.image.height dans imageToScreen.
  // resolveImgH() ajoute des fallbacks (CALPINAGE_PV_PANELS_DATA) pour éviter imgH=0
  // quand roof.image n'est pas encore initialisé (→ couche retournait null, contours rouges legacy visibles).
  const imgH = resolveImgH();
  if (imgH === 0) return null;
  return {
    contours: Array.isArray(st.contours) ? st.contours : [],
    ridges: Array.isArray(st.ridges) ? st.ridges : [],
    imgH,
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function KonvaContoursLayer() {
  const [snap, setSnap] = useState<LayerSnap | null>(null);

  /* Sync sur chaque frame legacy */
  useEffect(() => {
    const sync = () => {
      const s = readLayerSnap();
      if (s) setSnap(s);
    };
    sync(); // lecture immédiate (si l'état est déjà disponible)
    window.addEventListener(VIEWPORT_EVENT, sync);
    return () => window.removeEventListener(VIEWPORT_EVENT, sync);
  }, []);

  /* Kill switch — enregistrer la couche dans __CALPINAGE_KONVA_LAYERS__ */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const layers = w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined;
    layers?.add("contours");
    return () => {
      layers?.delete("contours");
    };
  }, []);

  if (!snap) return null;

  const { contours, ridges, imgH } = snap;

  return (
    <>
      {/* ── Contours bâti ─────────────────────────────────────────────────── */}
      {contours.map((c) => {
        if (!c.points || c.points.length < 2 || c.roofRole === "chienAssis") return null;

        // Conversion image-space Y=0-at-top → world-space Y=0-at-bottom
        const pts = c.points.flatMap((p) => [p.x, imgH - p.y]);

        return (
          <Group key={c.id} listening={false}>
            {/* Fill (contour fermé uniquement) */}
            {c.closed && (
              <Line
                points={pts}
                closed
                fill={STYLE.roofFill}
                stroke="transparent"
                strokeWidth={0}
                listening={false}
              />
            )}
            {/* Halo blanc */}
            <Line
              points={pts}
              closed={c.closed}
              stroke={STYLE.roofHalo}
              strokeWidth={STYLE.roofHaloWidth}
              strokeScaleEnabled={false}
              lineJoin="round"
              lineCap="round"
              listening={false}
            />
            {/* Trait bleu principal */}
            <Line
              points={pts}
              closed={c.closed}
              stroke={STYLE.roofStroke}
              strokeWidth={STYLE.roofStrokeWidth}
              strokeScaleEnabled={false}
              lineJoin="round"
              lineCap="round"
              listening={false}
            />
          </Group>
        );
      })}

      {/* ── Faîtages / ridges ─────────────────────────────────────────────── */}
      {ridges.map((r) => {
        if (!r.a || !r.b || r.roofRole === "chienAssis") return null;

        const pts = [r.a.x, imgH - r.a.y, r.b.x, imgH - r.b.y];

        return (
          <Group key={r.id} listening={false}>
            {/* Halo blanc */}
            <Line
              points={pts}
              stroke={STYLE.ridgeHalo}
              strokeWidth={STYLE.ridgeHaloWidth}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
            {/* Trait ambre principal */}
            <Line
              points={pts}
              stroke={STYLE.ridgeStroke}
              strokeWidth={STYLE.ridgeStrokeWidth}
              strokeScaleEnabled={false}
              lineCap="round"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}

export default KonvaContoursLayer;
