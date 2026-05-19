import type { ReactNode } from "react";
import "./crm-foundation.css";

export interface SettingsSectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className = "",
}: SettingsSectionProps) {
  return (
    <section className={`sn-settings-section ${className}`.trim()}>
      <header className="sn-settings-section__header">
        <div className="sn-settings-section__text">
          <h2 className="sn-settings-section__title">{title}</h2>
          {description ? <p className="sn-settings-section__description">{description}</p> : null}
        </div>
        {actions ? <div className="sn-settings-section__actions">{actions}</div> : null}
      </header>
      <div className="sn-settings-section__content">{children}</div>
    </section>
  );
}
