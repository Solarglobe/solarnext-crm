/**
 * Carte mission réutilisable — DayView & WeekView
 * Couleur du type, client prioritaire, heure, titre
 */

import React from "react";
import type { Mission } from "../../services/missions.service";

function getClientDisplayName(m: Mission): string {
  if (m.client_company_name) return m.client_company_name;
  const parts = [m.client_first_name, m.client_last_name].filter(Boolean);
  if (parts.length) return parts.join(" ");
  if (m.lead_company_name) return m.lead_company_name;
  const leadParts = [m.lead_contact_first_name, m.lead_contact_last_name].filter(Boolean);
  if (leadParts.length) return leadParts.join(" ");
  if (m.lead_full_name) return m.lead_full_name;
  return m.title;
}

function getContactKind(m: Mission): string {
  if (m.client_id) return "Client";
  if (m.lead_id) return "Lead";
  return "CRM";
}

function getProjectLabel(m: Mission): string {
  const study = m.study_title || m.study_number;
  if (study) return String(study);
  if (m.status === "completed") return "Terminé";
  if (m.status === "cancelled") return "Annulé";
  if (m.status === "in_progress") return "En cours";
  return "";
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
  const contactKind = getContactKind(mission);
  const projectLabel = getProjectLabel(mission);
  const assignmentCount = mission.assignments?.filter((a) => a.user_id || a.team_id).length ?? 0;

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
      <div className="mission-card-topline">
        <span className="mission-time">{timeStr}</span>
        <span className="mission-kind">{contactKind}</span>
      </div>
      <div className="mission-client">
        {clientName}
        {clientId}
      </div>
      <div className="mission-title" title={title}>
        {title}
      </div>
      {(projectLabel || assignmentCount > 0) && (
        <div className="mission-meta-row">
          {projectLabel && <span className="mission-meta">{projectLabel}</span>}
          {assignmentCount > 0 && (
            <span className="mission-meta">{assignmentCount} assigné{assignmentCount > 1 ? "s" : ""}</span>
          )}
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
