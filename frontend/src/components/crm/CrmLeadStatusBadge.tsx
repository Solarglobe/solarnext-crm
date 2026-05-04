import React from "react";
import {
  resolveCrmLeadStatusTone,
  crmLeadStatusShortLabel,
  type CrmLeadStatusTone,
  type CrmLeadStatusResolveOptions,
} from "./crmLeadStatusDisplay";

const TONE_BADGE_CLASS: Record<CrmLeadStatusTone, string> = {
  lead: "sn-badge sn-badge-neutral",
  qualified: "sn-badge sn-badge-info",
  client: "sn-badge sn-badge-success",
  lost: "sn-badge sn-badge-danger",
};

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

  const base = TONE_BADGE_CLASS[tone];

  return (
    <span className={`${base}${className ? ` ${className}` : ""}`.trim()} title={fullTitle}>
      {label}
    </span>
  );
}
