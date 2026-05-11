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
 *   → KonvaShadowVolumeHandlesLayer / KonvaPH3HandlesLayer : hors WorldGroup
 *     (screen-space, tailles fixes px).
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layer, Group, Stage } from "react-konva";
import type Konva from "konva";
import { useViewportSync } from "./useViewportSync";
import { KonvaContoursLayer } from "./KonvaContoursLayer";
import { KonvaPansLayer } from "./KonvaPansLayer";
import { KonvaObstaclesLayer } from "./KonvaObstaclesLayer";
import { KonvaShadowVolumesLayer } from "./KonvaShadowVolumesLayer";
import { KonvaShadowVolumeHandlesLayer } from "./KonvaShadowVolumeHandlesLayer";
import { KonvaPH3HandlesLayer } from "./KonvaPH3HandlesLayer";
import { KonvaPVPanelsLayer } from "./KonvaPVPanelsLayer";

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
  const stageRef = useRef<Konva.Stage | null>(null);

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
    // Remettre à jour sur chaque frame legacy + resize du canvas
    window.addEventListener("calpinage:viewport-changed", update);
    const ro = new ResizeObserver(update);
    ro.observe(canvasEl);
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

  /**
   * P4.4 — Expose le hit-test Konva pour les pans.
   * Retourne le pan.id (string) touché, ou null.
   */
  useEffect(() => {
    const w = window as Record<string, unknown>;
    w["__CALPINAGE_KONVA_PAN_HIT__"] = (clientX: number, clientY: number): string | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const stageContainer = stage.container();
      const rect = stageContainer.getBoundingClientRect();
      const pos = { x: clientX - rect.left, y: clientY - rect.top };
      const shape = stage.getIntersection(pos);
      if (!shape) return null;
      const match = shape.id().match(/^pan-(.+)$/);
      return match ? match[1] : null;
    };
    return () => {
      delete (w as Record<string, unknown>)["__CALPINAGE_KONVA_PAN_HIT__"];
    };
  }, []);

  /**
   * P4.3 — Expose le hit-test Konva pour les obstacles.
   * Retourne l'index de l'obstacle touché, ou -1 si aucun.
   */
  useEffect(() => {
    const w = window as Record<string, unknown>;
    w["__CALPINAGE_KONVA_OBS_HIT__"] = (clientX: number, clientY: number): number => {
      const stage = stageRef.current;
      if (!stage) return -1;
      const stageContainer = stage.container();
      const rect = stageContainer.getBoundingClientRect();
      const pos = { x: clientX - rect.left, y: clientY - rect.top };
      const shape = stage.getIntersection(pos);
      if (!shape) return -1;
      const match = shape.id().match(/^obs-(\d+)$/);
      return match ? parseInt(match[1], 10) : -1;
    };
    return () => {
      delete (w as Record<string, unknown>)["__CALPINAGE_KONVA_OBS_HIT__"];
    };
  }, []);

  /**
   * P4.5a — Expose le hit-test Konva pour les shadow volumes (body uniquement).
   * Retourne l'index du volume touché, ou -1 si aucun.
   */
  useEffect(() => {
    const w = window as Record<string, unknown>;
    w["__CALPINAGE_KONVA_SV_HIT__"] = (clientX: number, clientY: number): number => {
      const stage = stageRef.current;
      if (!stage) return -1;
      const stageContainer = stage.container();
      const rect = stageContainer.getBoundingClientRect();
      const pos = { x: clientX - rect.left, y: clientY - rect.top };
      const shape = stage.getIntersection(pos);
      if (!shape) return -1;
      const match = shape.id().match(/^sv-(\d+)$/);
      return match ? parseInt(match[1], 10) : -1;
    };
    return () => {
      delete (w as Record<string, unknown>)["__CALPINAGE_KONVA_SV_HIT__"];
    };
  }, []);

  /**
   * P4.6c — Expose le hit-test Konva pour les panneaux PV.
   * Retourne { blockId, panelId } du panneau touché, ou null si aucun.
   * Résolution via CALPINAGE_PV_PANELS_DATA.panels[idx] (même frame).
   */
  useEffect(() => {
    const w = window as Record<string, unknown>;
    w["__CALPINAGE_KONVA_PANEL_HIT__"] = (
      clientX: number,
      clientY: number,
    ): { blockId: string; panelId: string } | null => {
      const stage = stageRef.current;
      if (!stage) return null;
      const stageContainer = stage.container();
      const rect = stageContainer.getBoundingClientRect();
      const pos = { x: clientX - rect.left, y: clientY - rect.top };
      const shape = stage.getIntersection(pos);
      if (!shape) return null;
      const match = shape.id().match(/^pvp-(\d+)$/);
      if (!match) return null;
      const idx  = parseInt(match[1], 10);
      const data = w["CALPINAGE_PV_PANELS_DATA"] as
        | { panels: { blockId?: string | null; panelId?: string | null }[] }
        | null
        | undefined;
      const entry = data?.panels?.[idx];
      if (!entry?.blockId || !entry?.panelId) return null;
      return { blockId: entry.blockId, panelId: entry.panelId };
    };
    return () => {
      delete (w as Record<string, unknown>)["__CALPINAGE_KONVA_PANEL_HIT__"];
    };
  }, []);

  const container = containerRef.current;
  if (!container || !canvasEl || vp.width === 0 || vp.height === 0) return null;

  const overlay = (
    <div
      style={{
        position: "absolute",
        left: canvasOffset.left,
        top: canvasOffset.top,
        width: vp.width,
        height: vp.height,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <Stage
        ref={stageRef}
        width={vp.width}
        height={vp.height}
        listening={true}
        style={{ display: "block" }}
      >
        <Layer listening={true} clearBeforeDraw>
          {/*
           * WorldGroup — coordonnées image-space → écran-space.
           * Identique à ctx.transform(s, 0, 0, -s, ox, oy) du canvas legacy.
           */}
          <Group
            x={vp.offsetX}
            y={vp.offsetY}
            scaleX={vp.scale}
            scaleY={-vp.scale}
          >
            <KonvaContoursLayer />
            <KonvaPansLayer />
            <KonvaObstaclesLayer />
            <KonvaShadowVolumesLayer />

            {/* P4.6b — panneaux PV (frozen + active) en world-space */}
            <KonvaPVPanelsLayer />
          </Group>

          {/*
           * Couches screen-space — hors WorldGroup (tailles fixes px).
           * Positions calculées via imgToStage dans chaque composant.
           */}

          {/* P4.5b — handles shadow volume sélectionné (ROOF_EDIT) */}
          <KonvaShadowVolumeHandlesLayer />

          {/* P4.6a — handles PH3 bloc PV actif (PV_LAYOUT) — temporairement désactivé (bugs inversion + décalage + persistance) → legacy reprend le rendu */}
          {/* <KonvaPH3HandlesLayer /> */}

        </Layer>
      </Stage>
    </div>
  );

  // Portal dans containerRef : sibling de #calpinage-root dans le même stacking context
  return createPortal(overlay, container);
}

export default KonvaOverlay;
