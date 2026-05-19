import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

function DefaultEmptyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h7" />
    </svg>
  );
}

export function EmptyState({ title, description, icon, actions, className = "" }: EmptyStateProps) {
  return (
    <div className={`sn-empty-state ${className}`.trim()}>
      <div className="sn-empty-state__icon">{icon ?? <DefaultEmptyIcon />}</div>
      <h2 className="sn-empty-state__title">{title}</h2>
      {description ? <p className="sn-empty-state__description">{description}</p> : null}
      {actions ? <div className="sn-empty-state__actions">{actions}</div> : null}
    </div>
  );
}
