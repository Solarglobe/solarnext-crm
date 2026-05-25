import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface ToolbarProps {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function Toolbar({ search, filters, actions, meta, className = "" }: ToolbarProps) {
  return (
    <div className={`sn-toolbar ${className}`.trim()}>
      {search ? <div className="sn-toolbar__search">{search}</div> : null}
      {filters ? <div className="sn-toolbar__filters">{filters}</div> : null}
      {meta ? <div className="sn-toolbar__meta">{meta}</div> : null}
      {actions ? <div className="sn-toolbar__actions">{actions}</div> : null}
    </div>
  );
}
