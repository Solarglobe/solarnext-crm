import type { ReactNode } from "react";
import "./crm-foundation.css";

export type ErrorStateTone = "error" | "warning" | "info";

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  actions?: ReactNode;
  tone?: ErrorStateTone;
  className?: string;
}

function DefaultErrorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function ErrorState({
  title,
  message,
  actions,
  tone = "error",
  className = "",
}: ErrorStateProps) {
  const role = tone === "info" ? "status" : "alert";
  return (
    <div className={`sn-error-state sn-error-state--${tone} ${className}`.trim()} role={role}>
      <div className="sn-error-state__icon">
        <DefaultErrorIcon />
      </div>
      <div className="sn-error-state__body">
        {title ? <strong className="sn-error-state__title">{title}</strong> : null}
        <p className="sn-error-state__message">{message}</p>
      </div>
      {actions ? <div className="sn-error-state__actions">{actions}</div> : null}
    </div>
  );
}
