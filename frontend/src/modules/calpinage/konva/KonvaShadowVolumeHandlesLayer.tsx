/**
 * KonvaShadowVolumeHandlesLayer — P4.5b : handles du volume shadow sélectionné.
 *
 * Scope P4.5b : rendu seul. Le hit-test handles reste dans canvas-bundle
 * (CalpinageCanvas.hitTestShadowVolumeHandles) — pure math, pas de rendu.
 *
 * Visible uniquement en phase ROOF_EDIT pour le volume sélectionné.
 *
 * ── Screen-space ─────────────────────────────────────────────────────────────
 * Les handles ont des tailles fixes en pixels écran → ce composant est rendu
 * EN DEHORS du WorldGroup. Les positions sont calculées via imgToStage :
 *   screenX = imgPt.x * scale + offsetX
 *   screenY = -imgPt.y * scale + offsetY
 * Identique à ctx.transform(s,0,0,-s,ox,oy) du canvas legacy.
 *
 * ── Handles tube ──────────────────────────────────────────────────────────────
 *   "radius"  : disc blanc r=7px sur axe local +X (bord du tube)
 *   "rotate"  : handle premium 28px au nord du bord supérieur
 *
 * ── Handles cube ─────────────────────────────────────────────────────────────
 *   0..3      : disc blanc r=5.5px aux 4 coins (après rotation)
 *   "e0".."e3": disc blanc r=3.0px aux 4 milieux d'arêtes
 *   "rotate"  : idem tube, au nord du bord supérieur
 *
 * ── Rotate handle premium ────────────────────────────────────────────────────
 *   - Ligne connecteur : stroke rgba(37,99,235,0.30) 0.9px
 *   - Cercle extérieur : fill rgba(15,23,42,0.86) + stroke rgba(96,165,250,0.85)
 *                        + glow optionnel quand hoveredRotate
 *   - Arc interne r=4.2 (0.2π→1.7π) + flèche : via Shape.sceneFunc
 *
 * Globals lus :
 *   CALPINAGE_STATE.shadowVolumes / .currentPhase / .roof.scale.metersPerPixel
 *   window.CALPINAGE_SV_SEL_IDX       → index sélectionné (exposé en P4.5a)
 *   window.CALPINAGE_VIEWPORT_SCALE   → vp.scale
 *   window.CALPINAGE_VIEWPORT_OFFSET  → { x: offsetX, y: offsetY }
 *   window.CALPINAGE_SV_ROTATE_HOVERED → bool hover rotate (exposé en P4.5b)
 */

import { useEffect, useState } from "react";
import { Group, Circle, Line, Shape } from "react-konva";
import { resolveImgH } from "./resolveImgH";

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

type HandleSnap = {
  volume: ShadowVolume;
  scale: number;
  offsetX: number;
  offsetY: number;
  imgH: number;
  mpp: number;
  rotateHovered: boolean;
};

// ─── Constantes (identiques canvas-bundle) ───────────────────────────────────

const RECT_CORNER_R  = 5.5;   // rayon discs coins cube
const RECT_EDGE_R    = 3.0;   // rayon discs milieux arêtes cube
const HANDLE_OFFSET  = 28;    // px écran entre bord et handle rotate

const DISC = {
  fill:        "rgba(255, 255, 255, 0.82)",
  stroke:      "rgba(30, 64, 175, 0.75)",
  strokeWidth: 1,
} as const;

const ROT = {
  connStroke:   "rgba(37, 99, 235, 0.30)",
  connSW:       0.9,
  outerFill:    "rgba(15, 23, 42, 0.86)",
  outerStroke:  "rgba(96, 165, 250, 0.85)",
  outerSW:      1,
  outerR:       7,
  glowColor:    "rgba(37, 99, 235, 0.55)",
  glowBlur:     6,
  arcR:         4.2,
  arcA1:        Math.PI * 0.2,
  arcA2:        Math.PI * 1.7,
  arcStroke:    "rgba(191, 219, 254, 0.95)",
  arcSW:        1.25,
  arrowFill:    "rgba(191, 219, 254, 0.95)",
} as const;

const VIEWPORT_EVENT = "calpinage:viewport-changed";

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readHandleSnap(): HandleSnap | null {
  const w = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as
    | {
        currentPhase?: string;
        shadowVolumes?: ShadowVolume[];
        roof?: { scale?: { metersPerPixel?: number } };
      }
    | null
    | undefined;
  if (!st) return null;
  if (st.currentPhase !== "ROOF_EDIT") return null;

  const selIdx = w["CALPINAGE_SV_SEL_IDX"] as number | null | undefined;
  if (selIdx == null || selIdx < 0) return null;

  const sv = (st.shadowVolumes ?? [])[selIdx];
  if (!sv || sv.type !== "shadow_volume") return null;

  const scale   = (w["CALPINAGE_VIEWPORT_SCALE"] as number | undefined) ?? 1;
  const offset  = (w["CALPINAGE_VIEWPORT_OFFSET"] as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
  const imgH    = resolveImgH();
  const mpp     = st.roof?.scale?.metersPerPixel ?? 1;
  const rotateHovered = (w["CALPINAGE_SV_ROTATE_HOVERED"] as boolean | undefined) ?? false;

  return { volume: sv, scale, offsetX: offset.x, offsetY: offset.y, imgH, mpp, rotateHovered };
}

// ─── Helpers géométrie ────────────────────────────────────────────────────────

/** Rotation d'un point local autour de (cx,cy) en image-space. */
function rotPt(
  cx: number, cy: number,
  lx: number, ly: number,
  cos: number, sin: number,
): { x: number; y: number } {
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

/**
 * Conversion image-space → coordonnées Stage (screen px dans l'overlay).
 *
 * Identique au WorldGroup (scaleY=-scale) + convention `y_world = imgH - imgPt.y` :
 *   screenX = ox + pt.x * scale
 *   screenY = oy - (imgH - pt.y) * scale
 * Sans `imgH` les handles seraient décalés d'exactement `imgH * scale` px vers le bas.
 */
function imgToStage(
  pt: { x: number; y: number },
  scale: number,
  ox: number,
  oy: number,
  imgH: number,
): { x: number; y: number } {
  return { x: pt.x * scale + ox, y: -(imgH - pt.y) * scale + oy };
}

// ─── Sub-composants ───────────────────────────────────────────────────────────

/** Disc handle blanc (coins, arêtes, radius tube). */
function HandleDisc({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <Circle
      x={x} y={y} radius={r}
      fill={DISC.fill}
      stroke={DISC.stroke} strokeWidth={DISC.strokeWidth}
      listening={false}
    />
  );
}

/**
 * Handle rotate premium :
 *   - Ligne connecteur edge → handle
 *   - Cercle extérieur (avec glow optionnel)
 *   - Arc interne + flèche (via Shape.sceneFunc)
 */
function RotateHandle({
  edgePos,
  handlePos,
  hovered,
}: {
  edgePos: { x: number; y: number };
  handlePos: { x: number; y: number };
  hovered: boolean;
}) {
  return (
    <>
      {/* Ligne connecteur */}
      <Line
        points={[edgePos.x, edgePos.y, handlePos.x, handlePos.y]}
        stroke={ROT.connStroke}
        strokeWidth={ROT.connSW}
        lineCap="round"
        listening={false}
      />

      {/* Cercle extérieur : fond sombre + stroke bleu clair + glow si hovered */}
      <Circle
        x={handlePos.x} y={handlePos.y}
        radius={ROT.outerR}
        fill={ROT.outerFill}
        stroke={ROT.outerStroke} strokeWidth={ROT.outerSW}
        shadowEnabled={hovered}
        shadowColor={ROT.glowColor}
        shadowBlur={hovered ? ROT.glowBlur : 0}
        shadowOpacity={1}
        listening={false}
      />

      {/*
       * Arc interne (0.2π → 1.7π) + flèche via sceneFunc.
       * Shape positionné au centre du handle → (0,0) en sceneFunc = centre.
       */}
      <Shape
        x={handlePos.x} y={handlePos.y}
        sceneFunc={(ctx) => {
          // Arc
          ctx.beginPath();
          (ctx as unknown as CanvasRenderingContext2D).arc(
            0, 0, ROT.arcR, ROT.arcA1, ROT.arcA2,
          );
          ctx.strokeStyle = ROT.arcStroke;
          ctx.lineWidth = ROT.arcSW;
          ctx.stroke();

          // Flèche à l'extrémité de l'arc
          const ax = Math.cos(ROT.arcA2) * ROT.arcR;
          const ay = Math.sin(ROT.arcA2) * ROT.arcR;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - 3, ay - 1.5);
          ctx.lineTo(ax - 0.8, ay - 3.5);
          ctx.closePath();
          ctx.fillStyle = ROT.arrowFill;
          ctx.fill();
        }}
        listening={false}
      />
    </>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function KonvaShadowVolumeHandlesLayer() {
  const [snap, setSnap] = useState<HandleSnap | null>(null);

  /* Sync sur chaque frame legacy */
  useEffect(() => {
    const sync = () => {
      const s = readHandleSnap();
      setSnap(s);
    };
    sync();
    window.addEventListener(VIEWPORT_EVENT, sync);
    return () => window.removeEventListener(VIEWPORT_EVENT, sync);
  }, []);

  /* Kill switch — enregistrer "shadowVolumeHandles" */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.add("shadowVolumeHandles");
    return () => {
      (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.delete("shadowVolumeHandles");
    };
  }, []);

  if (!snap) return null;

  const { volume: sv, scale, offsetX, offsetY, imgH, mpp, rotateHovered } = snap;

  const wPx  = (sv.width  || 0.6) / mpp;
  const dPx  = (sv.depth  || 0.6) / mpp;
  const rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  // Offset handle rotate en image-px (depuis le bord supérieur)
  const offsetImg = HANDLE_OFFSET / scale;

  // Helper : image-space → stage (avec imgH pour aligner sur le WorldGroup)
  const toStage = (pt: { x: number; y: number }) =>
    imgToStage(pt, scale, offsetX, offsetY, imgH);

  if (sv.shape === "tube") {
    const r = wPx / 2;

    // "radius" handle : disc sur l'axe local +X
    const radiusImg = rotPt(sv.x, sv.y, r, 0, cos, sin);
    const radiusSc  = toStage(radiusImg);

    // Rotate handle : bord nord + position 28px au-delà
    const edgeTopImg    = rotPt(sv.x, sv.y, 0, -r, cos, sin);
    const handleRotImg  = rotPt(sv.x, sv.y, 0, -(r + offsetImg), cos, sin);
    const edgeTopSc     = toStage(edgeTopImg);
    const handleRotSc   = toStage(handleRotImg);

    return (
      <Group listening={false}>
        <HandleDisc x={radiusSc.x} y={radiusSc.y} r={7} />
        <RotateHandle
          edgePos={edgeTopSc}
          handlePos={handleRotSc}
          hovered={rotateHovered}
        />
      </Group>
    );
  }

  // ── Cube ───────────────────────────────────────────────────────────────────
  const hw = wPx / 2, hd = dPx / 2;

  // 4 coins
  const corners = [
    rotPt(sv.x, sv.y, -hw, -hd, cos, sin),
    rotPt(sv.x, sv.y,  hw, -hd, cos, sin),
    rotPt(sv.x, sv.y,  hw,  hd, cos, sin),
    rotPt(sv.x, sv.y, -hw,  hd, cos, sin),
  ];

  // 4 milieux d'arêtes
  const edges = [
    rotPt(sv.x, sv.y,   0, -hd, cos, sin),
    rotPt(sv.x, sv.y,  hw,   0, cos, sin),
    rotPt(sv.x, sv.y,   0,  hd, cos, sin),
    rotPt(sv.x, sv.y, -hw,   0, cos, sin),
  ];

  // Rotate handle
  const edgeTopImg   = rotPt(sv.x, sv.y, 0, -hd, cos, sin);
  const handleRotImg = rotPt(sv.x, sv.y, 0, -(hd + offsetImg), cos, sin);
  const edgeTopSc    = toStage(edgeTopImg);
  const handleRotSc  = toStage(handleRotImg);

  return (
    <Group listening={false}>
      {/* Discs coins */}
      {corners.map((p, i) => {
        const sc = toStage(p);
        return <HandleDisc key={`c${i}`} x={sc.x} y={sc.y} r={RECT_CORNER_R} />;
      })}

      {/* Discs milieux arêtes */}
      {edges.map((p, i) => {
        const sc = toStage(p);
        return <HandleDisc key={`e${i}`} x={sc.x} y={sc.y} r={RECT_EDGE_R} />;
      })}

      {/* Rotate handle */}
      <RotateHandle
        edgePos={edgeTopSc}
        handlePos={handleRotSc}
        hovered={rotateHovered}
      />
    </Group>
  );
}

export default KonvaShadowVolumeHandlesLayer;
