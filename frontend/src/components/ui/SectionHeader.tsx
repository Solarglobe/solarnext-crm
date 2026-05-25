import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface SectionHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className = "",
}: SectionHeaderProps) {
  return (
    <header className={`sn-section-header ${className}`.trim()}>
      <div className="sn-section-header__text">
        {eyebrow ? <p className="sn-section-header__eyebrow">{eyebrow}</p> : null}
        <h2 className="sn-section-header__title">{title}</h2>
        {description ? <p className="sn-section-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="sn-section-header__actions">{actions}</div> : null}
    </header>
  );
}
