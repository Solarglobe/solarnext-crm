/**
 * KonvaObstaclesLayer — P4.2 shadow layer : obstacles toiture posés.
 *
 * Shadow layer : le legacy continue de dessiner les mêmes formes sur le canvas.
 * Ce composant les redessine sur le Stage Konva pour valider l'alignement pixel.
 * Le kill switch legacy (guard __CALPINAGE_KONVA_LAYERS__.has("obstacles"))
 * désactive le rendu legacy dès que cette couche est montée.
 *
 * Rendu P4.2 : état normal uniquement (pas de sélection ni création — P4.3).
 *
 * Convention coordonnées (WorldGroup x=ox y=oy scaleX=s scaleY=-s) :
 *   y_world = imgH - imgPt.y  (identique à KonvaContoursLayer)
 *
 * strokeScaleEnabled={false} : épaisseur de trait fixe en pixels écran,
 * identique au comportement legacy (ctx.lineWidth indépendant du zoom).
 *
 * Label : fontSize en world-units = 10.5 / scale → ~10.5px écran à tout zoom.
 *   scaleY={-1} sur le Text pour contrebalancer le flip Y du WorldGroup.
 */

import { useEffect, useState } from "react";
import { Group, Line, Text } from "react-konva";

// ─── Types ────────────────────────────────────────────────────────────────────

type ImgPt = { x: number; y: number };

type Obstacle = {
  id?: string;
  points: ImgPt[];
  meta?: { label?: string };
  kind?: string;
};

type LayerSnap = {
  obstacles: Obstacle[];
  imgH: number;
  scale: number;
};

// ─── Couleurs (inline legacy, section 4c-2) ───────────────────────────────────

const STYLE = {
  fill:        "rgba(71, 85, 105, 0.18)",
  stroke:      "rgba(51, 65, 85, 0.82)",
  strokeWidth: 1.15,
  labelFill:   "rgba(30, 41, 59, 0.82)",
  labelSize:   10.5,            // px écran cible
  labelFont:   "system-ui, sans-serif",
  labelOffsetX: -20,            // px écran (vers la gauche, identique legacy)
} as const;

const VIEWPORT_EVENT = "calpinage:viewport-changed";

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readLayerSnap(): LayerSnap | null {
  const w = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as
    | { obstacles?: Obstacle[]; roof?: { image?: { height?: number } } }
    | null
    | undefined;
  if (!st) return null;
  const imgH = st.roof?.image?.height ?? 0;
  if (imgH === 0) return null;
  const scale = (w["CALPINAGE_VIEWPORT_SCALE"] as number | undefined) ?? 1;
  return {
    obstacles: Array.isArray(st.obstacles) ? st.obstacles : [],
    imgH,
    scale,
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function KonvaObstaclesLayer() {
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
    layers?.add("obstacles");
    return () => {
      (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.delete("obstacles");
    };
  }, []);

  if (!snap) return null;

  const { obstacles, imgH, scale } = snap;
  const fontSize = STYLE.labelSize / scale;
  const labelOffsetX = STYLE.labelOffsetX / scale;

  return (
    <>
      {obstacles.map((obs, i) => {
        if (!obs.points || obs.points.length < 3) return null;

        // Conversion image-space Y=0-at-top → world-space Y=0-at-bottom
        const pts = obs.points.flatMap((p) => [p.x, imgH - p.y]);

        // Centroïde en world-space
        const worldCx = obs.points.reduce((s, p) => s + p.x, 0) / obs.points.length;
        const worldCy =
          obs.points.reduce((s, p) => s + (imgH - p.y), 0) / obs.points.length;

        const label = obs.meta?.label ?? obs.kind ?? "";

        return (
          <Group key={obs.id ?? i} listening={false}>
            {/*
             * id="obs-{i}" + listening={true} : shape enregistrée dans le hit canvas Konva.
             * Permet à stage.getIntersection() de trouver l'obstacle (P4.3).
             * pointer-events reste none sur l'overlay div → aucun DOM event ne remonte ici.
             */}
            <Line
              id={`obs-${i}`}
              points={pts}
              closed
              fill={STYLE.fill}
              stroke={STYLE.stroke}
              strokeWidth={STYLE.strokeWidth}
              strokeScaleEnabled={false}
              lineJoin="round"
              lineCap="round"
              listening={true}
            />
            {/* Label au centroïde */}
            {label ? (
              <Text
                x={worldCx + labelOffsetX}
                y={worldCy}
                text={label}
                fontSize={fontSize}
                fontFamily={STYLE.labelFont}
                fill={STYLE.labelFill}
                /*
                 * scaleY=-1 pour contrebalancer le flip du WorldGroup (scaleY=-s).
                 * Résultat : texte à l'endroit, taille ~10.5px écran.
                 */
                scaleY={-1}
                listening={false}
              />
            ) : null}
          </Group>
        );
      })}
    </>
  );
}

export default KonvaObstaclesLayer;
