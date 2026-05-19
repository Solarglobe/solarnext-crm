import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface ActionBarProps {
  primary?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}

export function ActionBar({ primary, secondary, className = "" }: ActionBarProps) {
  return (
    <div className={`sn-action-bar ${className}`.trim()}>
      <div className="sn-action-bar__group">{primary}</div>
      {secondary ? <div className="sn-action-bar__group sn-action-bar__group--secondary">{secondary}</div> : null}
    </div>
  );
}
