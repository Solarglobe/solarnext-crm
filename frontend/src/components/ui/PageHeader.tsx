import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`sn-page-header ${className}`.trim()}>
      <div className="sn-page-header__main">
        <div className="sn-page-header__text">
          {eyebrow ? <p className="sn-page-header__eyebrow">{eyebrow}</p> : null}
          <h1 className="sn-page-header__title">{title}</h1>
          {description ? <p className="sn-page-header__description">{description}</p> : null}
        </div>
        {actions ? <div className="sn-page-header__actions">{actions}</div> : null}
      </div>
      {meta ? <div className="sn-page-header__meta">{meta}</div> : null}
    </header>
  );
}
