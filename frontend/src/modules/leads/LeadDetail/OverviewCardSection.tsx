import React, { useId, useState } from "react";

export interface OverviewCardSectionProps {
  index: number;
  title: string;
  children: React.ReactNode;
  /** Ouvert au montage (accordéon). */
  defaultOpen?: boolean;
  /** Sous-texte dans l’en-tête lorsque la section est repliée (données réelles uniquement). */
  summary?: string | null;
  /** Classe optionnelle sur `<section>` (ex. overflow pour popover autocomplete). */
  sectionClassName?: string;
}

/**
 * Section repliable de la Vue générale — surface unique (pas de carte imbriquée).
 */
export function OverviewCardSection({
  index,
  title,
  children,
  defaultOpen = true,
  summary,
  sectionClassName,
}: OverviewCardSectionProps) {
  const reactId = useId();
  const headingId = `overview-section-${index}-${reactId.replace(/:/g, "")}`;
  const panelId = `${headingId}-panel`;
  const [open, setOpen] = useState(defaultOpen);
  const summaryText = summary?.trim() || null;

  return (
    <section
      className={`crm-lead-overview-section${open ? " crm-lead-overview-section--open" : " crm-lead-overview-section--closed"}${sectionClassName ? ` ${sectionClassName}` : ""}`}
      aria-labelledby={headingId}
    >
      <button
        type="button"
        className="crm-lead-overview-section-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        id={`${headingId}-btn`}
      >
        <div className="crm-lead-overview-section-toggle-text">
          <h2 id={headingId} className="crm-lead-overview-section-title">
            {title}
          </h2>
          {!open && summaryText ? (
            <p className="crm-lead-overview-section-summary">{summaryText}</p>
          ) : null}
        </div>
        <div className="crm-lead-overview-section-toggle-end">
          <span className="crm-lead-overview-section-index" aria-hidden>
            {index}
          </span>
          <span className="crm-lead-overview-section-chevron" aria-hidden />
        </div>
      </button>
      <div
        id={panelId}
        className="crm-lead-overview-section-body-wrap"
        role="region"
        aria-labelledby={headingId}
        aria-hidden={!open}
      >
        <div className="crm-lead-overview-section-body">{children}</div>
      </div>
    </section>
  );
}
