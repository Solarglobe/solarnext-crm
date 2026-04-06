/**
 * Carte mission réutilisable — DayView & WeekView
 * Couleur du type, client prioritaire, heure, titre
 */

import React from "react";
import type { Mission } from "../../services/missions.service";

function getClientDisplayName(m: Mission): string {
  if (m.client_company_name) return m.client_company_name;
  const parts = [m.client_first_name, m.client_last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : m.title;
}

function formatTimeHHmm(d: Date): string {
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface MissionCardProps {
  mission: Mission;
  isDragging?: boolean;
  style?: React.CSSProperties;
  pointerHandlers?: Record<string, unknown>;
  resizeHandlers?: Record<string, unknown>;
}

export default function MissionCard({
  mission,
  isDragging = false,
  style = {},
  pointerHandlers = {},
  resizeHandlers = {},
}: MissionCardProps) {
  const mStart = new Date(mission.start_at);
  const mEnd = new Date(mission.end_at);
  const durationMin =
    (mEnd.getTime() - mStart.getTime()) / (60 * 1000);
  const compact = durationMin < 75;
  const color = mission.mission_type_color || "var(--violet-strong)";
  const clientName = getClientDisplayName(mission);
  const clientId = mission.client_number ? ` (${mission.client_number})` : "";
  const title = mission.mission_type_name || mission.title;

  const timeStr = `${formatTimeHHmm(mStart)} – ${formatTimeHHmm(mEnd)}`;

  return (
    <div
      className={`planning-mission-card ${compact ? "mission-card-compact" : ""}`}
      style={
        {
          ...style,
          "--mission-color": color,
          opacity: isDragging ? 0.3 : 1,
        } as React.CSSProperties
      }
      {...pointerHandlers}
    >
      <div className="mission-time">
        {timeStr}
      </div>
      <div className="mission-client">
        {clientName}
        {clientId}
      </div>
      {clientName !== title && (
        <div className="mission-title" title={title}>
          {title}
        </div>
      )}
      {Object.keys(resizeHandlers).length > 0 && (
        <div
          className="mission-resize-handle"
          {...resizeHandlers}
        />
      )}
    </div>
  );
}
