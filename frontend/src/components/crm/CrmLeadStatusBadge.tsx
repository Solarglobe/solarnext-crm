import React from "react";
import {
  resolveCrmLeadStatusTone,
  crmLeadStatusShortLabel,
  type CrmLeadStatusResolveOptions,
} from "./crmLeadStatusDisplay";
import "./crm-lead-status-badge.css";

export interface CrmLeadStatusBadgeProps {
  status?: string | null;
  stageName?: string | null;
  stageCode?: string | null;
  className?: string;
  title?: string;
}

export function CrmLeadStatusBadge({
  status,
  stageName,
  stageCode,
  className = "",
  title,
}: CrmLeadStatusBadgeProps) {
  const opts: CrmLeadStatusResolveOptions = { stageName, stageCode };
  const tone = resolveCrmLeadStatusTone(status, opts);
  const label = crmLeadStatusShortLabel(status, tone);
  const raw = status != null && String(status).trim() !== "" ? String(status).trim() : null;
  const fullTitle =
    title ?? (raw && raw.toUpperCase() !== label.toUpperCase() ? `${label} — ${raw}` : label);

  return (
    <span
      className={`crm-status-badge crm-status-badge--${tone}${className ? ` ${className}` : ""}`.trim()}
      title={fullTitle}
    >
      {label}
    </span>
  );
}
