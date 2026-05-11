/**
 * KonvaPVPanelsLayer — P4.6b/P4.6c : rendu + hit-test panneaux PV (frozen + active).
 *
 * ── Rendu ────────────────────────────────────────────────────────────────────
 * Un Shape.sceneFunc unique dessine tous les panneaux (zéro nœud par panneau).
 *
 * ── Hit-test (P4.6c) ─────────────────────────────────────────────────────────
 * N Shapes invisibles (hitFunc seulement, sceneFunc vide) — un par panneau.
 * Chaque Shape a id="pvp-{idx}" ; KonvaOverlay expose __CALPINAGE_KONVA_PANEL_HIT__
 * qui lit panels[idx].{blockId,panelId} depuis CALPINAGE_PV_PANELS_DATA.
 *
 * ── Convention coordonnées ───────────────────────────────────────────────────
 * world-space (WorldGroup x=ox y=oy scaleX=s scaleY=-s) :
 *   wx = imgPt.x,  wy = imgH - imgPt.y
 *
 * ── Visuels par panneau (identiques renderImpl) ───────────────────────────────
 *   1. Fill #13171B
 *   2. Grille bilinéaire (clip) : rgba(255,255,255,0.30) 1px
 *   3. Border intérieur #242A2F 1.2px
 *   4. Frame color (frameColor, outlineWidth, dash)
 *   5. Dormer overlay rgba(0,0,0,0.18)
 *   6. Invalid overlay rgba(239,68,68,0.25)
 *   outlineOnly (panel désactivé) : skip 1-3.
 *
 * Globals lus :
 *   window.CALPINAGE_PV_PANELS_DATA → { panels, imgH, scale }
 *   window.CALPINAGE_STATE.currentPhase (guard PV_LAYOUT)
 */

import { useEffect, useState } from "react";
import { Shape } from "react-konva";
import type Konva from "konva";

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelEntry = {
  points:       { x: number; y: number }[];
  frameColor:   string;
  outlineWidth: number;
  dash:         number[];
  outlineOnly:  boolean;
  invalid:      boolean;
  dormerShaded: boolean;
  glow:         boolean;
  /** P4.6c — identifiant bloc (UUID) ; null si non encore renseigné (données P4.6b sans mise à jour) */
  blockId:      string | null;
  /** P4.6c — identifiant panneau (UUID ou "legacy-{idx}") ; null si non encore renseigné */
  panelId:      string | null;
};

type PVPanelsSnap = {
  panels: PanelEntry[];
  imgH:   number;
  scale:  number;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const PANEL_FILL         = "#13171B";
const PANEL_BORDER       = "#242A2F";
const PANEL_BORDER_W     = 1.2;   // px écran
const GRID_STROKE        = "rgba(255,255,255,0.30)";
const GLOW_COLOR         = "rgba(99,102,241,0.55)";
const GLOW_BLUR_SC       = 10;    // px écran
const DORMER_FILL        = "rgba(0,0,0,0.18)";
const INVALID_FILL       = "rgba(239,68,68,0.25)";

const VIEWPORT_EVENT = "calpinage:viewport-changed";

// ─── Lecture état legacy ──────────────────────────────────────────────────────

function readSnap(): PVPanelsSnap | null {
  const w  = window as unknown as Record<string, unknown>;
  const st = w["CALPINAGE_STATE"] as { currentPhase?: string } | null | undefined;
  if (!st || st.currentPhase !== "PV_LAYOUT") return null;

  const data = w["CALPINAGE_PV_PANELS_DATA"] as PVPanelsSnap | null | undefined;
  if (!data || !Array.isArray(data.panels) || data.panels.length === 0) return null;

  return data;
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function KonvaPVPanelsLayer() {
  const [snap, setSnap] = useState<PVPanelsSnap | null>(null);

  /* Sync sur chaque frame legacy */
  useEffect(() => {
    const sync = () => setSnap(readSnap());
    sync();
    window.addEventListener(VIEWPORT_EVENT, sync);
    return () => window.removeEventListener(VIEWPORT_EVENT, sync);
  }, []);

  /* Kill switch — enregistrer la couche dans __CALPINAGE_KONVA_LAYERS__ */
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.add("pvPanels");
    return () => {
      (w["__CALPINAGE_KONVA_LAYERS__"] as Set<string> | undefined)?.delete("pvPanels");
    };
  }, []);

  if (!snap) return null;

  const { panels, imgH, scale } = snap;

  return (
    <>
    {/*
     * ── Shape rendu unique ────────────────────────────────────────────────
     * listening=false : aucune interactivité sur ce shape.
     * Le hit-test est délégué aux N shapes hitFunc ci-dessous (P4.6c).
     */}
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        /*
         * Konva.Context expose la plupart des API canvas2D directement.
         * Pour setLineDash et shadowBlur on accède au contexte natif.
         */
        const native = ctx as unknown as CanvasRenderingContext2D;

        for (let ei = 0; ei < panels.length; ei++) {
          const entry = panels[ei];
          if (!entry.points || entry.points.length < 3) continue;

          // Conversion image-space → world-space (Y-flip)
          const pts = entry.points;
          const n   = pts.length;

          /** Construit le path dans le ctx courant. */
          const buildPath = () => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, imgH - pts[0].y);
            for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, imgH - pts[i].y);
            ctx.closePath();
          };

          if (!entry.outlineOnly) {
            // ── 1. Fill ────────────────────────────────────────────────────
            buildPath();
            ctx.fillStyle = PANEL_FILL;
            ctx.fill();

            // ── 2. Grille bilinéaire (clip) ───────────────────────────────
            if (n >= 4) {
              ctx.save();
              buildPath();
              ctx.clip();

              const p0x = pts[0].x, p0y = imgH - pts[0].y;
              const p1x = pts[1].x, p1y = imgH - pts[1].y;
              const p2x = pts[2].x, p2y = imgH - pts[2].y;
              const p3x = pts[3].x, p3y = imgH - pts[3].y;

              // Distances en px écran (world × scale)
              const wPx = Math.hypot(p1x - p0x, p1y - p0y) * scale;
              const hPx = Math.hypot(p3x - p0x, p3y - p0y) * scale;
              const cell = Math.max(4, Math.min(wPx, hPx) / 10);
              const cols = Math.max(4, Math.min(30, Math.floor(wPx / cell)));
              const rows = Math.max(4, Math.min(30, Math.floor(hPx / cell)));

              ctx.strokeStyle = GRID_STROKE;
              ctx.lineWidth   = 1 / scale; // 1 px écran
              native.setLineDash([]);

              // Colonnes : interpolation le long de l'arête gauche (p0→p3) et droite (p1→p2)
              for (let ci = 1; ci < cols; ci++) {
                const t = ci / cols;
                ctx.beginPath();
                ctx.moveTo(p0x + (p3x - p0x) * t, p0y + (p3y - p0y) * t);
                ctx.lineTo(p1x + (p2x - p1x) * t, p1y + (p2y - p1y) * t);
                ctx.stroke();
              }
              // Rangées : interpolation le long de l'arête supérieure (p0→p1) et inférieure (p3→p2)
              for (let cj = 1; cj < rows; cj++) {
                const t = cj / rows;
                ctx.beginPath();
                ctx.moveTo(p0x + (p1x - p0x) * t, p0y + (p1y - p0y) * t);
                ctx.lineTo(p3x + (p2x - p3x) * t, p3y + (p2y - p3y) * t);
                ctx.stroke();
              }

              ctx.restore();
            }

            // ── 3. Border intérieur ────────────────────────────────────────
            buildPath();
            ctx.strokeStyle = PANEL_BORDER;
            ctx.lineWidth   = PANEL_BORDER_W / scale;
            native.setLineDash([]);
            ctx.stroke();
          }

          // ── 4. Frame color (outline) ──────────────────────────────────────
          if (entry.glow) {
            native.shadowColor = GLOW_COLOR;
            native.shadowBlur  = GLOW_BLUR_SC / scale;
          }
          ctx.strokeStyle = entry.frameColor;
          ctx.lineWidth   = entry.outlineWidth / scale;
          native.setLineDash(entry.dash.map((d) => d / scale));
          buildPath();
          ctx.stroke();
          if (entry.glow) {
            native.shadowBlur = 0;
          }
          native.setLineDash([]);

          // ── 5. Dormer shadow overlay ──────────────────────────────────────
          if (entry.dormerShaded) {
            buildPath();
            ctx.fillStyle = DORMER_FILL;
            ctx.fill();
          }

          // ── 6. Invalid overlay ────────────────────────────────────────────
          if (entry.invalid) {
            buildPath();
            ctx.fillStyle = INVALID_FILL;
            ctx.fill();
          }
        }

        // Nettoyage final pour ne pas polluer les prochains draws Konva
        native.setLineDash([]);
        native.shadowBlur = 0;
      }}
    />

    {/*
     * ── P4.6c : N shapes hit-test invisibles ─────────────────────────────
     * Un Shape par panneau, sceneFunc vide, hitFunc = polygone exact.
     * id="pvp-{idx}" → KonvaOverlay.__CALPINAGE_KONVA_PANEL_HIT__ résout
     * blockId/panelId via CALPINAGE_PV_PANELS_DATA.panels[idx].
     */}
    {panels.map((entry, idx) => {
      if (!entry.points || entry.points.length < 3) return null;
      const pts = entry.points;
      const n   = pts.length;
      const wy0 = imgH - pts[0].y;
      return (
        <Shape
          key={`pvp-hit-${idx}`}
          id={`pvp-${idx}`}
          listening={true}
          perfectDrawEnabled={false}
          sceneFunc={() => {}}
          hitFunc={(ctx: Konva.Context, shape: Konva.Shape) => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, wy0);
            for (let i = 1; i < n; i++) {
              ctx.lineTo(pts[i].x, imgH - pts[i].y);
            }
            ctx.closePath();
            ctx.fillStrokeShape(shape);
          }}
        />
      );
    })}
    </>
  );
}

export default KonvaPVPanelsLayer;
