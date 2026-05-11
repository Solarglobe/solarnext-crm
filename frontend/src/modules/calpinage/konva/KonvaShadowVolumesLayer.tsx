/**
 * KonvaShadowVolumesLayer — P4.5a : body footprint shadow volumes (tube + cube).
 *
 * Scope P4.5a : rendu body + hit-test body uniquement.
 * Les handles (rotate, coin, arête) restent dans canvas-bundle — P4.5b.
 *
 * Convention coordonnées (WorldGroup x=ox y=oy scaleX=s scaleY=-s) :
 *   y_world = imgH - imgPt.y  (identique KonvaObstaclesLayer / KonvaContoursLayer)
 *
 * Formes :
 *   tube → Circle  (centre cx,cy ; radius = width / (2*mpp) en image-px)
 *   cube → Line fermée, 4 coins calculés en image-space puis convertis en world-space
 *          (même algo que renderImpl : rotPt + Y-flip)
 *
 * États visuels (identiques legacy section SHADOW_VOLUMES) :
 *   normal   : fill slate 0.13 + stroke slate 0.78  1.2px
 *   placing  : fill blue 0.08 + stroke blue 0.72    1.35px  dash [5,5]
 *   selected : fill blue 0.16 + 3 strokes halo (blanc 3.2 / bleu 1.7 / bleu léger 0.9)
 *
 * Globals lus :
 *   CALPINAGE_STATE.shadowVolumes
 *   CALPINAGE_STATE.roof.image.height
 *   CALPINAGE_STATE.roof.scale.metersPerPixel
 *   window.CALPINAGE_SV_SEL_IDX     → drawState.selectedShadowVolumeIndex
 *   window.CALPINAGE_SV_PLACING_IDX → drawState.isPlacingShadowVolume ? selectedIdx : null
 *
 * Hit canvas :
 *   Chaque volume a une shape transparente id="sv-{i}" listening={true}
 *   → utilisée par __CALPINAGE_KONVA_SV_HIT__ dans KonvaOverlay.
 */

import { useEffect, useState } from "react";
import { Group, Circle, Line } from "react-konva";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShadowVolume = {
  id?: string;
  type: string;
  shape: "tube" | "cube" | string;
  x: number;
  y: number;
  width: number;
  depth?: number;
  rotation?: number;
};

type LayerSnap = {
  shadowVolumes: ShadowVolume[];
  imgH: number;
  mpp: number;
  selIdx: number | null;
  placingIdx: number | null;
};

// ─── Couleurs (identiques renderImpl legacy — section SHADOW_VOLUMES) ─────────

const STYLE = {
  normalFill:    "rgba(51, 65, 85, 0.13)",
  normalStroke:  "rgba(51, 65, 85, 0.78)",
  normalSW:      1.2,

  placingFill:   "rgba(37, 99, 235, 0.08)",
  placingStroke: "rgba(37, 99, 235, 0.72)",
  placingSW:     1.35,
  placingDash:   [5, 5] as number[],

  selFill:   "rgba(37, 99, 235, 0.16)",
  selHalo:   "rgba(255, 255, 255, 0.90)",
  selHaloSW: 3.2,
  selMain:   "rgba(30, 64, 175, 0.88)",
  selMainSW: 1.7,
  selInner:  "rgba(37, 99, 235, 0.42)",
  selInnerSW: 0.9,
} as const;

const VIEWPORT_EVENT = "calpinage:viewport-changed";

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readLayerSnap(): LayerSnap | null {
  const w = window as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as
    | {
        shadowVolumes?: ShadowVolume[];
        roof?: { image?: { height?: number }; scale?: { metersPerPixel?: number } };
      }
    | null
    | undefined;
  if (!st) return null;
  const imgH = st.roof?.image?.height ?? 0;
  if (imgH === 0) return null;
  const mpp = st.roof?.scale?.metersPerPixel ?? 1;
  return {
    shadowVolumes: Array.isArray(st.shadowVolumes) ? st.shadowVolumes : [],
    imgH,
    mpp,
    selIdx: (w["CALPINAGE_SV_SEL_IDX"] as number | null | undefined) ?? null,
    placingIdx: (w["CALPINAGE_SV_PLACING_IDX"] as number | null | undefined) ?? null,
  };
}

// ─── Helper géométrie ─────────────────────────────────────────────────────────

/** Rotation d'un point local (lx,ly) autour du centre (cx,cy) — image-space. */
function rotPt(
  cx: number, cy: number,
  lx: number, ly: number,
  cos: number, sin: number,
): { x: number; y: number } {
  return {
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function KonvaShadowVolumesLayer() {
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
    const w = window as Record<string, unknown>;
    (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.add("shadowVolumes");
    return () => {
      (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.delete("shadowVolumes");
    };
  }, []);

  if (!snap) return null;

  const { shadowVolumes, imgH, mpp, selIdx, placingIdx } = snap;

  return (
    <>
      {shadowVolumes.map((sv, i) => {
        if (!sv || sv.type !== "shadow_volume") return null;

        const wPx  = (sv.width  || 0.6) / mpp;
        const dPx  = (sv.depth  || 0.6) / mpp;
        const rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
        const rotRad = (rotDeg * Math.PI) / 180;
        const cos = Math.cos(rotRad);
        const sin = Math.sin(rotRad);

        const isPlacing = placingIdx === i;
        const isSel     = selIdx === i && !isPlacing;

        const bodyFill = isPlacing ? STYLE.placingFill
                       : isSel    ? STYLE.selFill
                       :            STYLE.normalFill;

        // ── TUBE ────────────────────────────────────────────────────────────
        if (sv.shape === "tube") {
          const r  = wPx / 2;
          const cx = sv.x;
          const cy = imgH - sv.y; // image-space → world-space

          return (
            <Group key={sv.id ?? i} listening={false}>
              {/*
               * Hit canvas : cercle transparent id="sv-{i}" + listening={true}
               * Utilisé par __CALPINAGE_KONVA_SV_HIT__ (P4.5a).
               */}
              <Circle
                id={`sv-${i}`}
                x={cx} y={cy} radius={r}
                fill="rgba(0,0,0,0)"
                stroke="transparent" strokeWidth={0}
                listening={true}
              />

              {/* Fill */}
              <Circle x={cx} y={cy} radius={r}
                fill={bodyFill} stroke="transparent" strokeWidth={0}
                listening={false}
              />

              {/* Stroke — placing */}
              {isPlacing && (
                <Circle x={cx} y={cy} radius={r}
                  fill="transparent"
                  stroke={STYLE.placingStroke} strokeWidth={STYLE.placingSW}
                  strokeScaleEnabled={false}
                  dash={STYLE.placingDash}
                  listening={false}
                />
              )}

              {/* Strokes — selected (3 passes : halo / main / inner) */}
              {isSel && (
                <>
                  <Circle x={cx} y={cy} radius={r} fill="transparent"
                    stroke={STYLE.selHalo} strokeWidth={STYLE.selHaloSW}
                    strokeScaleEnabled={false} listening={false} />
                  <Circle x={cx} y={cy} radius={r} fill="transparent"
                    stroke={STYLE.selMain} strokeWidth={STYLE.selMainSW}
                    strokeScaleEnabled={false} listening={false} />
                  <Circle x={cx} y={cy} radius={r} fill="transparent"
                    stroke={STYLE.selInner} strokeWidth={STYLE.selInnerSW}
                    strokeScaleEnabled={false} listening={false} />
                </>
              )}

              {/* Stroke — normal */}
              {!isPlacing && !isSel && (
                <Circle x={cx} y={cy} radius={r}
                  fill="transparent"
                  stroke={STYLE.normalStroke} strokeWidth={STYLE.normalSW}
                  strokeScaleEnabled={false}
                  listening={false}
                />
              )}
            </Group>
          );
        }

        // ── CUBE ────────────────────────────────────────────────────────────
        const hw = wPx / 2, hd = dPx / 2;

        // Coins en image-space (rotation autour du centre)
        const corners = [
          rotPt(sv.x, sv.y, -hw, -hd, cos, sin),
          rotPt(sv.x, sv.y,  hw, -hd, cos, sin),
          rotPt(sv.x, sv.y,  hw,  hd, cos, sin),
          rotPt(sv.x, sv.y, -hw,  hd, cos, sin),
        ];
        // Conversion image-space Y=0-at-top → world-space Y=0-at-bottom
        const pts = corners.flatMap((p) => [p.x, imgH - p.y]);

        return (
          <Group key={sv.id ?? i} listening={false}>
            {/*
             * Hit canvas : polygone transparent id="sv-{i}" + listening={true}
             * Utilisé par __CALPINAGE_KONVA_SV_HIT__ (P4.5a).
             */}
            <Line
              id={`sv-${i}`}
              points={pts} closed
              fill="rgba(0,0,0,0)"
              stroke="transparent" strokeWidth={0}
              listening={true}
            />

            {/* Fill */}
            <Line points={pts} closed
              fill={bodyFill} stroke="transparent" strokeWidth={0}
              listening={false}
            />

            {/* Stroke — placing */}
            {isPlacing && (
              <Line points={pts} closed fill="transparent"
                stroke={STYLE.placingStroke} strokeWidth={STYLE.placingSW}
                strokeScaleEnabled={false} dash={STYLE.placingDash}
                lineJoin="round" lineCap="round"
                listening={false}
              />
            )}

            {/* Strokes — selected (3 passes) */}
            {isSel && (
              <>
                <Line points={pts} closed fill="transparent"
                  stroke={STYLE.selHalo} strokeWidth={STYLE.selHaloSW}
                  strokeScaleEnabled={false} lineJoin="round" lineCap="round"
                  listening={false} />
                <Line points={pts} closed fill="transparent"
                  stroke={STYLE.selMain} strokeWidth={STYLE.selMainSW}
                  strokeScaleEnabled={false} lineJoin="round" lineCap="round"
                  listening={false} />
                <Line points={pts} closed fill="transparent"
                  stroke={STYLE.selInner} strokeWidth={STYLE.selInnerSW}
                  strokeScaleEnabled={false} lineJoin="round" lineCap="round"
                  listening={false} />
              </>
            )}

            {/* Stroke — normal */}
            {!isPlacing && !isSel && (
              <Line points={pts} closed fill="transparent"
                stroke={STYLE.normalStroke} strokeWidth={STYLE.normalSW}
                strokeScaleEnabled={false} lineJoin="round" lineCap="round"
                listening={false}
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

export default KonvaShadowVolumesLayer;
