import React, { useId } from "react";

export interface OverviewCardSectionProps {
  index: number;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean; // conservé pour compatibilité, ignoré
  summary?: string | null; // conservé pour compatibilité, ignoré
  sectionClassName?: string;
}

/**
 * Section plate de la Vue générale — toujours visible, pas d'accordéon.
 */
export function OverviewCardSection({
  index,
  title,
  children,
  sectionClassName,
}: OverviewCardSectionProps) {
  const reactId = useId();
  const headingId = `overview-section-${index}-${reactId.replace(/:/g, "")}`;

  return (
    <section
      className={`crm-lead-overview-section crm-lead-overview-section--open${sectionClassName ? ` ${sectionClassName}` : ""}`}
      aria-labelledby={headingId}
    >
      <div className="crm-lead-overview-section-header">
        <h2 id={headingId} className="crm-lead-overview-section-title">
          {title}
        </h2>
      </div>
      <div className="crm-lead-overview-section-body">{children}</div>
    </section>
  );
}
