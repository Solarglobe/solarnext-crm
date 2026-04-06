import React from "react";

interface LeadEmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryHint?: string;
}

export default function LeadEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  secondaryHint,
}: LeadEmptyStateProps) {
  return (
    <div className="crm-lead-empty-state">
      <div className="crm-lead-empty-state-inner">
        <h3 className="crm-lead-empty-state-title">{title}</h3>
        <p className="crm-lead-empty-state-desc">{description}</p>
        {secondaryHint ? <p className="crm-lead-empty-state-hint">{secondaryHint}</p> : null}
        {actionLabel && onAction ? (
          <button type="button" className="sn-btn sn-btn-primary sn-btn-sm" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
