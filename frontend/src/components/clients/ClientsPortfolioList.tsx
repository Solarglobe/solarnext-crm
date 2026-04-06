/**
 * Liste compacte portefeuille dossiers PV — ordre = API (pas de tri local).
 */

import React, { useCallback } from "react";
import type { Lead } from "../../services/leads.service";
import { getLeadName, getLeadPhoneDisplay } from "../../services/leads.service";
import {
  formatUpdatedAtRelative,
  getProjectTracking,
} from "./projectPvTracking";

export interface ClientsPortfolioListProps {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFull: (id: string) => void;
}

export function ClientsPortfolioList({
  leads,
  selectedId,
  onSelect,
  onOpenFull,
}: ClientsPortfolioListProps) {
  const onRowClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      onSelect(id);
    },
    [onSelect]
  );

  const onRowDoubleClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      onOpenFull(id);
    },
    [onOpenFull]
  );

  if (!leads || leads.length === 0) {
    return (
      <div className="clients-portfolio-empty">
        <p className="clients-portfolio-empty__title">Aucun dossier</p>
        <p className="clients-portfolio-empty__text">
          Ajustez les filtres ou vérifiez que des projets signés sont présents.
        </p>
      </div>
    );
  }

  return (
    <div className="clients-portfolio-list" role="grid" aria-label="Portefeuille dossiers">
      <div className="clients-portfolio-list__head" role="row">
        <div className="clients-portfolio-list__th" role="columnheader">
          Dossier
        </div>
        <div className="clients-portfolio-list__th" role="columnheader">
          Statut
        </div>
        <div className="clients-portfolio-list__th" role="columnheader">
          Avancement
        </div>
        <div className="clients-portfolio-list__th" role="columnheader">
          Prochaine étape
        </div>
        <div className="clients-portfolio-list__th" role="columnheader">
          Activité
        </div>
      </div>
      <div className="clients-portfolio-list__body" role="rowgroup">
        {leads.map((lead) => {
          const name = getLeadName(lead);
          const tel = getLeadPhoneDisplay(lead);
          const ps = lead.project_status;
          const tracking = getProjectTracking(lead);
          const act = formatUpdatedAtRelative(lead);
          const psKey = (ps ?? "NONE").toUpperCase();
          const rowId = String(lead.id);
          const isSelected =
            selectedId != null && String(selectedId) === rowId;

          return (
            <div
              key={rowId}
              role="row"
              className={`clients-portfolio-list__row${isSelected ? " clients-portfolio-list__row--selected" : ""}`}
              tabIndex={0}
              aria-selected={isSelected}
              onClick={(e) => onRowClick(e, rowId)}
              onDoubleClick={(e) => onRowDoubleClick(e, rowId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(lead.id);
                }
              }}
            >
              <div className="clients-portfolio-list__cell clients-portfolio-list__cell--name">
                <span className="clients-portfolio-list__name">{name}</span>
                {tel ? (
                  <span className="clients-portfolio-list__sub">{tel}</span>
                ) : null}
              </div>
              <div className="clients-portfolio-list__cell">
                {ps ? (
                  <span
                    className={`badge-project badge-project--compact ${psKey}`}
                    title={ps}
                  >
                    {tracking.statusLabel}
                  </span>
                ) : (
                  <span className="clients-portfolio-list__muted">—</span>
                )}
              </div>
              <div className="clients-portfolio-list__cell clients-portfolio-list__cell--progress">
                <div className="progress-line">
                  <div className="progress-bar progress-bar--compact progress-bar--line">
                    <div
                      className="progress-fill"
                      style={{ width: `${tracking.progress}%` }}
                    />
                  </div>
                  <div className="progress-meta">
                    <span className="progress-percent">
                      {tracking.progress}%
                    </span>
                    <span
                      className="progress-text"
                      title={tracking.nextStep}
                    >
                      {tracking.nextStep}
                    </span>
                  </div>
                </div>
              </div>
              <div
                className={`clients-portfolio-list__cell clients-portfolio-list__cell--act${act.warn ? " clients-portfolio-list__cell--warn" : ""}`}
              >
                {act.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
