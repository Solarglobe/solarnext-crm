import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface SettingsCardProps {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  as?: "article" | "div";
  className?: string;
  children?: ReactNode;
}

export function SettingsCard({
  title,
  description,
  badge,
  footer,
  actions,
  as = "article",
  className = "",
  children,
}: SettingsCardProps) {
  const Component = as;
  return (
    <Component className={`sn-settings-card ${className}`.trim()}>
      <div className="sn-settings-card__head">
        <div className="sn-settings-card__text">
          <strong className="sn-settings-card__title">{title}</strong>
          {description ? <p className="sn-settings-card__description">{description}</p> : null}
        </div>
        {badge ? <div className="sn-settings-card__badge">{badge}</div> : null}
      </div>
      {children ? <div className="sn-settings-card__content">{children}</div> : null}
      {(footer || actions) ? (
        <div className="sn-settings-card__footer">
          {footer ? <small>{footer}</small> : <span />}
          {actions ? <div className="sn-settings-card__actions">{actions}</div> : null}
        </div>
      ) : null}
    </Component>
  );
}
