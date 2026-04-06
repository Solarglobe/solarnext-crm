/**
 * Hook pour le drag custom du planning (pointer events)
 * Remplace le HTML5 DnD natif
 * CP-067: drag horizontal WeekView, resize par le bas
 */

import { useCallback, useRef, useState } from "react";
import type { Mission } from "../../services/missions.service";
import {
  computeNewStartMs,
  computeResizeEndMs,
  getResizeBounds,
  snapToQuarterMs,
  deltaYToMinutes,
  type GridBounds,
} from "./planning-drag.utils";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export interface UsePlanningDragOptions {
  hourHeight: number;
  /** Retourne le début de la grille (heure de départ) pour un timestamp donné */
  getGridStartMs: (ms: number) => number;
  /** Retourne les bornes min/max pour le clamp (6h-20h ou plage existante) */
  getGridBounds?: (mission: Mission) => GridBounds;
  /** Largeur d'une colonne jour en px (WeekView uniquement) — active le drag horizontal */
  columnWidthPx?: number;
  /** Début de la semaine affichée (pour clamp horizontal) */
  weekStart?: Date;
  /** Heure min du jour pour bounds dynamiques (WeekView: 8) */
  gridMinHour?: number;
  /** Heure max du jour pour bounds dynamiques (WeekView: 20) */
  gridMaxHour?: number;
  onDrop: (missionId: string, newStartISO: string) => void;
  onDragStart?: (mission: Mission) => void;
  onDragEnd?: () => void;
  /** Appelé quand clic sans mouvement (pas de drag) — évite PATCH inutile */
  onMissionClick?: (missionId: string) => void;
  /** Resize par le bas — PATCH end_at uniquement */
  onResizeEnd?: (missionId: string, newEndISO: string) => void;
}

export interface DragState {
  mission: Mission | null;
  previewTopPx: number;
  blockRect: { left: number; width: number } | null;
  /** Offset horizontal en px (WeekView) pour la preview */
  dayOffsetPx?: number;
  /** Hauteur preview en px (resize) */
  previewHeightPx?: number;
}

type PointerMode = "drag" | "resize" | null;

export function usePlanningDrag({
  hourHeight,
  getGridStartMs,
  getGridBounds,
  columnWidthPx,
  weekStart,
  gridMinHour,
  gridMaxHour,
  onDrop,
  onDragStart,
  onDragEnd,
  onMissionClick,
  onResizeEnd,
}: UsePlanningDragOptions) {
  const getGridStartMsRef = useRef(getGridStartMs);
  getGridStartMsRef.current = getGridStartMs;
  const getGridBoundsRef = useRef(getGridBounds);
  getGridBoundsRef.current = getGridBounds;
  const hasMovedRef = useRef(false);
  const [dragState, setDragState] = useState<DragState>({
    mission: null,
    previewTopPx: 0,
    blockRect: null,
  });

  const previewRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const initialYRef = useRef(0);
  const initialXRef = useRef(0);
  const originalStartMsRef = useRef(0);
  const originalEndMsRef = useRef(0);
  const blockRectRef = useRef<{ left: number; width: number } | null>(null);
  const missionRef = useRef<Mission | null>(null);
  const capturedElementRef = useRef<HTMLElement | null>(null);
  const modeRef = useRef<PointerMode>(null);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const mode = modeRef.current;
      const mission = missionRef.current;
      if (!mission) return;

      if (mode === "resize") {
        hasMovedRef.current = true;
        const deltaY = e.clientY - initialYRef.current;
        const bounds = getResizeBounds(mission);
        const newEndMs = computeResizeEndMs(
          originalEndMsRef.current,
          deltaY,
          hourHeight,
          new Date(mission.start_at).getTime(),
          bounds
        );
        const durationMs = newEndMs - new Date(mission.start_at).getTime();
        const previewHeightPx = (durationMs / (60 * 60 * 1000)) * hourHeight;

        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setDragState((prev) =>
            prev.mission ? { ...prev, previewHeightPx } : prev
          );
        });
        return;
      }

      if (mode === "drag") {
        hasMovedRef.current = true;

        const deltaY = e.clientY - initialYRef.current;
        const deltaX = columnWidthPx ? e.clientX - initialXRef.current : 0;

        let newStartMs: number;
        let dayOffset = 0;

        if (columnWidthPx && columnWidthPx > 0 && weekStart) {
          dayOffset = Math.round(deltaX / columnWidthPx);
          dayOffset = Math.max(-6, Math.min(6, dayOffset));
          const minutesOffset = deltaYToMinutes(deltaY, hourHeight);
          const dayMs = dayOffset * 24 * 60 * 60 * 1000;
          const minutesMs = minutesOffset * 60 * 1000;
          let ms =
            originalStartMsRef.current + dayMs + minutesMs;
          const originalStartDate = new Date(originalStartMsRef.current);
          const targetDate = addDays(originalStartDate, dayOffset);
          if (gridMinHour != null && gridMaxHour != null) {
            const durationMs =
              originalEndMsRef.current - originalStartMsRef.current;
            const minD = new Date(targetDate);
            minD.setHours(gridMinHour, 0, 0, 0);
            const maxD = new Date(targetDate);
            maxD.setHours(gridMaxHour, 0, 0, 0);
            const boundsForTargetDay = {
              minMs: minD.getTime(),
              maxMs: maxD.getTime() - durationMs,
            };
            ms = Math.max(
              boundsForTargetDay.minMs,
              Math.min(boundsForTargetDay.maxMs, ms)
            );
          }
          newStartMs = snapToQuarterMs(ms);
        } else {
          const bounds = getGridBoundsRef.current?.(mission);
          newStartMs = computeNewStartMs(
            originalStartMsRef.current,
            deltaY,
            hourHeight,
            bounds
          );
        }

        const dayOffsetPx = columnWidthPx ? dayOffset * columnWidthPx : 0;

        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (previewRef.current) {
            const gridStart = getGridStartMsRef.current(newStartMs);
            const topPx =
              ((newStartMs - gridStart) / (60 * 60 * 1000)) * hourHeight;
            previewRef.current.style.transform = `translateY(${topPx}px)`;
          }
          setDragState((prev) =>
            prev.mission ? { ...prev, dayOffsetPx } : prev
          );
        });
      }
    },
    [hourHeight, columnWidthPx, weekStart, gridMinHour, gridMaxHour]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      const mode = modeRef.current;
      const mission = missionRef.current;
      if (!mission) return;

      if (mode === "resize") {
        const captured = capturedElementRef.current;
        if (captured?.releasePointerCapture) {
          captured.releasePointerCapture(e.pointerId);
        }
        capturedElementRef.current = null;
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        missionRef.current = null;
        blockRectRef.current = null;
        modeRef.current = null;
        setDragState({ mission: null, previewTopPx: 0, blockRect: null });

        if (!hasMovedRef.current) {
          onDragEnd?.();
          return;
        }
        const deltaY = e.clientY - initialYRef.current;
        const bounds = getResizeBounds(mission);
        const newEndMs = computeResizeEndMs(
          originalEndMsRef.current,
          deltaY,
          hourHeight,
          new Date(mission.start_at).getTime(),
          bounds
        );
        const newEndISO = new Date(newEndMs).toISOString();
        onDragEnd?.();
        onResizeEnd?.(mission.id, newEndISO);
        return;
      }

      if (mode === "drag") {
        if (!hasMovedRef.current) {
          const captured = capturedElementRef.current;
          if (captured?.releasePointerCapture) {
            captured.releasePointerCapture(e.pointerId);
          }
          capturedElementRef.current = null;
          document.removeEventListener("pointermove", handlePointerMove);
          document.removeEventListener("pointerup", handlePointerUp);
          missionRef.current = null;
          blockRectRef.current = null;
          modeRef.current = null;
          setDragState({ mission: null, previewTopPx: 0, blockRect: null });
          onDragEnd?.();
          onMissionClick?.(mission.id);
          return;
        }

        const captured = capturedElementRef.current;
        if (captured?.releasePointerCapture) {
          captured.releasePointerCapture(e.pointerId);
        }
        capturedElementRef.current = null;
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);

        const deltaY = e.clientY - initialYRef.current;
        const deltaX = columnWidthPx ? e.clientX - initialXRef.current : 0;

        let newStartMs: number;
        let dayOffset = 0;

        if (columnWidthPx && columnWidthPx > 0 && weekStart) {
          dayOffset = Math.round(deltaX / columnWidthPx);
          dayOffset = Math.max(-6, Math.min(6, dayOffset));
          const minutesOffset = deltaYToMinutes(deltaY, hourHeight);
          const dayMs = dayOffset * 24 * 60 * 60 * 1000;
          const minutesMs = minutesOffset * 60 * 1000;
          let ms =
            originalStartMsRef.current + dayMs + minutesMs;
          const originalStartDate = new Date(originalStartMsRef.current);
          const targetDate = addDays(originalStartDate, dayOffset);
          if (gridMinHour != null && gridMaxHour != null) {
            const durationMs =
              originalEndMsRef.current - originalStartMsRef.current;
            const minD = new Date(targetDate);
            minD.setHours(gridMinHour, 0, 0, 0);
            const maxD = new Date(targetDate);
            maxD.setHours(gridMaxHour, 0, 0, 0);
            const boundsForTargetDay = {
              minMs: minD.getTime(),
              maxMs: maxD.getTime() - durationMs,
            };
            ms = Math.max(
              boundsForTargetDay.minMs,
              Math.min(boundsForTargetDay.maxMs, ms)
            );
          }
          newStartMs = snapToQuarterMs(ms);
        } else {
          const bounds = getGridBoundsRef.current?.(mission);
          newStartMs = computeNewStartMs(
            originalStartMsRef.current,
            deltaY,
            hourHeight,
            bounds
          );
        }

        const newStartISO = new Date(newStartMs).toISOString();

        missionRef.current = null;
        blockRectRef.current = null;
        modeRef.current = null;
        setDragState({ mission: null, previewTopPx: 0, blockRect: null });
        onDragEnd?.();
        onDrop(mission.id, newStartISO);
      }
    },
    [
      hourHeight,
      columnWidthPx,
      weekStart,
      gridMinHour,
      gridMaxHour,
      onDrop,
      onDragEnd,
      onMissionClick,
      onResizeEnd,
      handlePointerMove,
    ]
  );

  const getMissionPointerHandlers = useCallback(
    (mission: Mission, getContainer: () => HTMLElement | null) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        hasMovedRef.current = false;

        const containerEl = getContainer();
        if (!containerEl) return;

        const blockEl = e.currentTarget as HTMLElement;
        const blockRect = blockEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        const scrollTop = containerEl.scrollTop ?? 0;

        initialYRef.current = e.clientY;
        initialXRef.current = e.clientX;
        originalStartMsRef.current = new Date(mission.start_at).getTime();
        originalEndMsRef.current = new Date(mission.end_at).getTime();
        const blockLeft = blockRect.left - containerRect.left;
        const blockWidth = blockRect.width;

        missionRef.current = mission;
        blockRectRef.current = { left: blockLeft, width: blockWidth };
        capturedElementRef.current = blockEl;
        modeRef.current = "drag";

        const previewTopPx = blockRect.top - containerRect.top + scrollTop;
        const durationMs =
          new Date(mission.end_at).getTime() - new Date(mission.start_at).getTime();
        const previewHeightPx =
          (durationMs / (60 * 60 * 1000)) * hourHeight;

        setDragState({
          mission,
          previewTopPx,
          blockRect: { left: blockLeft, width: blockWidth },
          previewHeightPx,
        });
        onDragStart?.(mission);

        blockEl.setPointerCapture?.(e.pointerId);
        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);
      },
    }),
    [onDragStart, handlePointerMove, handlePointerUp, onMissionClick, onDragEnd, hourHeight]
  );

  const getResizePointerHandlers = useCallback(
    (mission: Mission, getContainer: () => HTMLElement | null) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        hasMovedRef.current = false;

        const containerEl = getContainer();
        if (!containerEl) return;

        const blockEl = (e.currentTarget as HTMLElement).closest(
          ".planning-mission-card"
        ) as HTMLElement;
        if (!blockEl) return;

        const blockRect = blockEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        const scrollTop = containerEl.scrollTop ?? 0;

        initialYRef.current = e.clientY;
        originalEndMsRef.current = new Date(mission.end_at).getTime();
        const blockLeft = blockRect.left - containerRect.left;
        const blockWidth = blockRect.width;

        missionRef.current = mission;
        blockRectRef.current = { left: blockLeft, width: blockWidth };
        capturedElementRef.current = blockEl;
        modeRef.current = "resize";

        const previewTopPx = blockRect.top - containerRect.top + scrollTop;
        const durationMs =
          new Date(mission.end_at).getTime() - new Date(mission.start_at).getTime();
        const previewHeightPx =
          (durationMs / (60 * 60 * 1000)) * hourHeight;

        setDragState({
          mission,
          previewTopPx,
          blockRect: { left: blockLeft, width: blockWidth },
          previewHeightPx,
        });
        onDragStart?.(mission);

        blockEl.setPointerCapture?.(e.pointerId);
        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);
      },
    }),
    [onDragStart, handlePointerMove, handlePointerUp, onDragEnd, hourHeight]
  );

  return {
    dragState,
    previewRef,
    getMissionPointerHandlers,
    getResizePointerHandlers,
  };
}
