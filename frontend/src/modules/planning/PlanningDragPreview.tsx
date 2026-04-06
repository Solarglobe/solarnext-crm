/**
 * Preview visuelle pendant le drag custom
 * Ligne fine horizontale + ghost du bloc mission
 */

import React from "react";
import type { Mission } from "../../services/missions.service";
import type { DragState } from "./usePlanningDrag";

interface PlanningDragPreviewProps {
  dragState: DragState;
  previewRef: React.RefObject<HTMLDivElement | null>;
  hourHeight: number;
  columnWidthPx?: number;
}

function getClientDisplayName(m: Mission): string {
  if (m.client_company_name) return m.client_company_name;
  const parts = [m.client_first_name, m.client_last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : m.title;
}

export default function PlanningDragPreview({
  dragState,
  previewRef,
  hourHeight,
  columnWidthPx: _columnWidthPx,
}: PlanningDragPreviewProps) {
  const {
    mission,
    blockRect,
    previewTopPx,
    dayOffsetPx = 0,
    previewHeightPx,
  } = dragState;

  if (!mission || !blockRect) return null;

  const mStart = new Date(mission.start_at);
  const mEnd = new Date(mission.end_at);
  const durationH = (mEnd.getTime() - mStart.getTime()) / (60 * 60 * 1000);
  const heightPx =
    previewHeightPx !== undefined ? previewHeightPx : durationH * hourHeight;
  const clientName = getClientDisplayName(mission);
  const clientId = mission.client_number ? ` (${mission.client_number})` : "";

  return (
    <div
      ref={previewRef as React.Ref<HTMLDivElement>}
      className="planning-drag-preview-container"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        transform: `translateY(${previewTopPx}px)`,
      }}
    >
      {/* Ligne fine horizontale à la position snapée */}
      <div className="planning-drag-preview-line" />
      {/* Ghost du bloc mission — style MissionCard premium */}
      <div
        className="planning-drag-preview-ghost planning-mission-card"
        style={{
          position: "absolute",
          left: blockRect.left + (dayOffsetPx || 0),
          width: blockRect.width,
          height: heightPx,
          top: 0,
          ["--mission-color" as string]:
            mission.mission_type_color || "var(--violet-strong)",
        }}
      >
        <div className="mission-time">
          {mStart.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
        <div className="mission-client">
          {clientName}
          {clientId}
        </div>
        {clientName !== (mission.mission_type_name || mission.title) && (
          <div className="mission-title">
            {mission.mission_type_name || mission.title}
          </div>
        )}
      </div>
    </div>
  );
}
