/**
 * KonvaPH3HandlesLayer — P4.6a : poignées de manipulation du bloc PV actif.
 *
 * Scope P4.6a : rendu seul. Le hit-test reste dans canvas-bundle
 * (ph3PointerNearHandleScreen) — pure math, pas de rendu.
 *
 * Visible uniquement en phase PV_LAYOUT avec un focusBlock actif.
 *
 * ── Screen-space ─────────────────────────────────────────────────────────────
 * Handles en tailles fixes px écran → rendu HORS WorldGroup.
 * Positions calculées via imgToStage :
 *   screenX = imgPt.x * scale + offsetX
 *   screenY = -imgPt.y * scale + offsetY
 * Identique à ctx.transform(s,0,0,-s,ox,oy) du canvas legacy.
 *
 * ── Handles ──────────────────────────────────────────────────────────────────
 *   "rotate"  : disque r=9 fill=#6366F1 + arc icon (0.3π→1.8π r=5) + flèche 2 branches
 *   "move"    : disque r=6 fill=white + croix ±3.5px
 *   stems     : lignes topOfBlock→rotate et topOfBlock→move
 *
 * Globals lus :
 *   CALPINAGE_STATE.currentPhase
 *   window.CALPINAGE_PH3_HANDLES  → { rotate, move, topOfBlock, hoverHandle }
 *                                    (exposé dans renderImpl P4.6a)
 *   window.CALPINAGE_VIEWPORT_SCALE
 *   window.CALPINAGE_VIEWPORT_OFFSET
 */

import { useEffect, useState } from "react";
import { Group, Line, Circle, Shape } from "react-konva";

// ─── Types ────────────────────────────────────────────────────────────────────

type HandlePositions = {
  rotate:     { x: number; y: number };
  move:       { x: number; y: number };
  topOfBlock: { x: number; y: number };
  hoverHandle: "rotate" | "move" | null;
};

type HandleSnap = {
  handles: HandlePositions;
  // P4.6a-fix : coordonnées désormais en screen-space — scale/offset supprimés
};

// ─── Constantes (identiques renderImpl) ──────────────────────────────────────

const ROTATE_R  = 9;
const MOVE_R    = 6;
const ARC_R     = 5;
const ARC_START = Math.PI * 0.3;
const ARC_END   = Math.PI * 1.8;
const ARR_LEN   = 2.2;
const CROSS_LEN = 3.5;

const VIEWPORT_EVENT = "calpinage:viewport-changed";
const HANDLES_EVENT  = "calpinage:ph3-handles-changed"; // P4.6a-fix : dispatché après écriture de CALPINAGE_PH3_HANDLES

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readHandleSnap(): HandleSnap | null {
  const w  = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as { currentPhase?: string } | null | undefined;
  if (!st || st.currentPhase !== "PV_LAYOUT") return null;

  const handles = w["CALPINAGE_PH3_HANDLES"] as HandlePositions | null | undefined;
  if (!handles) return null;

  // P4.6a-fix : coordonnées déjà en screen-space — pas de conversion nécessaire
  return { handles };
}
// ─── Composant principal ──────────────────────────────────────────────────────

export function KonvaPH3HandlesLayer() {
  const [snap, setSnap] = useState<HandleSnap | null>(null);

  /* Sync sur chaque frame legacy */
  useEffect(() => {
    const sync = () => setSnap(readHandleSnap());
    sync();
    window.addEventListener(VIEWPORT_EVENT, sync);   // transitions de phase (null quand hors PV_LAYOUT)
    window.addEventListener(HANDLES_EVENT,  sync);   // P4.6a-fix : données courantes après écriture
    return () => {
      window.removeEventListener(VIEWPORT_EVENT, sync);
      window.removeEventListener(HANDLES_EVENT,  sync);
    };
  }, []);

  /* Kill switch — enregistrer la couche */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.add("ph3Handles");
    return () => {
      (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.delete("ph3Handles");
    };
  }, []);

  if (!snap) return null;

  const { handles } = snap;
  const { rotate, move, topOfBlock, hoverHandle } = handles;

  // P4.6a-fix : coordonnées déjà en screen-space — utilisation directe sans imgToStage
  const rSc    = rotate;
  const mSc    = move;
  const stemSc = topOfBlock;

  const hovAny = !!hoverHandle;
  const hovRot = hoverHandle === "rotate";
  const hovMov = hoverHandle === "move";

  return (
    <Group listening={false}>

      {/* ── Tige topOfBlock → rotate ────────────────────────────────────── */}
      <Line
        points={[stemSc.x, stemSc.y, rSc.x, rSc.y]}
        stroke={hovAny ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.30)"}
        strokeWidth={hovAny ? 1.25 : 1}
        lineCap="round"
        listening={false}
      />

      {/* ── Tige topOfBlock → move ──────────────────────────────────────── */}
      <Line
        points={[stemSc.x, stemSc.y, mSc.x, mSc.y]}
        stroke={hovAny ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.30)"}
        strokeWidth={hovAny ? 1.25 : 1}
        lineCap="round"
        listening={false}
      />

      {/* ── Rotate : disque indigo + glow ───────────────────────────────── */}
      <Circle
        x={rSc.x} y={rSc.y}
        radius={ROTATE_R}
        fill="#6366F1"
        stroke={hovRot ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.35)"}
        strokeWidth={hovRot ? 1.5 : 1}
        shadowEnabled={true}
        shadowColor="rgba(99,102,241,0.55)"
        shadowBlur={hovRot ? 2.2 : 1.5}
        shadowOpacity={1}
        listening={false}
      />

      {/*
       * Rotate : arc interne (0.3π → 1.8π) + flèche 2 branches.
       * Shape centré au disque → (0,0) en sceneFunc = centre.
       */}
      <Shape
        x={rSc.x} y={rSc.y}
        sceneFunc={(ctx) => {
          // Arc
          ctx.beginPath();
          (ctx as unknown as CanvasRenderingContext2D).arc(
            0, 0, ARC_R, ARC_START, ARC_END,
          );
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth   = 1;
          ctx.stroke();

          // Flèche à l'extrémité de l'arc
          const tipX = Math.cos(ARC_END) * ARC_R;
          const tipY = Math.sin(ARC_END) * ARC_R;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(
            tipX + Math.cos(ARC_END - 0.5) * ARR_LEN,
            tipY + Math.sin(ARC_END - 0.5) * ARR_LEN,
          );
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(
            tipX + Math.cos(ARC_END + 0.5) * ARR_LEN,
            tipY + Math.sin(ARC_END + 0.5) * ARR_LEN,
          );
          ctx.stroke();
        }}
        listening={false}
      />

      {/* ── Move : disque blanc ─────────────────────────────────────────── */}
      <Circle
        x={mSc.x} y={mSc.y}
        radius={MOVE_R}
        fill="#ffffff"
        stroke={hovMov ? "rgba(99,102,241,0.95)" : "#6366F1"}
        strokeWidth={hovMov ? 1.5 : 1}
        listening={false}
      />

      {/* Move : croix centrée ±3.5px */}
      <Shape
        x={mSc.x} y={mSc.y}
        sceneFunc={(ctx) => {
          ctx.strokeStyle = "#6366F1";
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(-CROSS_LEN, 0);
          ctx.lineTo( CROSS_LEN, 0);
          ctx.moveTo(0, -CROSS_LEN);
          ctx.lineTo(0,  CROSS_LEN);
          ctx.stroke();
        }}
        listening={false}
      />

    </Group>
  );
}

export default KonvaPH3HandlesLayer;
