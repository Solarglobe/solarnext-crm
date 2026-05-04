/**
 * Liste compacte portefeuille dossiers PV — ordre = API (pas de tri local).
 */

import React, { useCallback, useMemo } from "react";
import type { Lead } from "../../services/leads.service";
import { getLeadName, getLeadPhoneDisplay } from "../../services/leads.service";
import {
  formatUpdatedAtRelative,
  getProjectTracking,
} from "./projectPvTracking";
import { isLeadArchivedRecord } from "../../services/leads.service";
import { CrmLeadStatusBadge } from "../crm/CrmLeadStatusBadge";

function portfolioPipelineBadgeClass(stageKey: string): string {
  const k = stageKey.toUpperCase();
  const successStages = [
    "SIGNE",
    "TERMINE",
    "FACTURATION_TERMINEE",
    "CLOTURE",
    "MISE_EN_SERVICE",
    "CONSUEL_OBTENU",
  ];
  const warnStages = [
    "INSTALLATION",
    "INSTALLATION_PLANIFIEE",
    "INSTALLATION_REALISEE",
    "RACCORDEMENT",
    "CONSUEL_EN_ATTENTE",
  ];
  const infoStages = ["MAIRIE", "ACCORD_MAIRIE", "DP_A_DEPOSER", "DP_DEPOSE", "DP_ACCEPTE", "PLANIFICATION"];
  let tone: "neutral" | "info" | "warn" | "success" = "neutral";
  if (successStages.includes(k)) tone = "success";
  else if (warnStages.includes(k)) tone = "warn";
  else if (infoStages.includes(k)) tone = "info";
  return `sn-badge sn-badge-${tone} clients-portfolio-list__stage-sn`;
}

export interface ClientsPortfolioListProps {
  leads: Lead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFull: (id: string) => void;
  /** Sélection pour envoi groupé (cases à cocher). */
  selectedIds?: string[];
  onToggleBulkSelect?: (id: string) => void;
  onSelectAllOnPage?: () => void;
  /** Liste vide : bouton pour effacer les filtres */
  onResetFilters?: () => void;
}

export function ClientsPortfolioList({
  leads,
  selectedId,
  onSelect,
  onOpenFull,
  selectedIds = [],
  onToggleBulkSelect,
  onSelectAllOnPage,
  onResetFilters,
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

  const bulkEnabled = Boolean(onToggleBulkSelect && onSelectAllOnPage);
  const idSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const pageIds = useMemo(() => leads.map((l) => String(l.id)), [leads]);
  const allOnPageSelected =
    bulkEnabled && pageIds.length > 0 && pageIds.every((id) => idSet.has(id));
  const someOnPageSelected =
    bulkEnabled && pageIds.some((id) => idSet.has(id)) && !allOnPageSelected;

  if (!leads || leads.length === 0) {
    return (
      <div className="clients-portfolio-empty">
        <p className="clients-portfolio-empty__title">Aucun dossier trouvé</p>
        <p className="clients-portfolio-empty__text">
          Ajustez les filtres ou vérifiez que des projets signés sont présents.
        </p>
        {onResetFilters ? (
          <button
            type="button"
            className="sn-btn sn-btn-outline sn-btn-sm clients-portfolio-empty__reset"
            onClick={onResetFilters}
          >
            Réinitialiser les filtres
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`clients-portfolio-list${bulkEnabled ? " clients-portfolio-list--bulk" : ""}`}
      role="grid"
      aria-label="Portefeuille dossiers"
    >
      <div className="clients-portfolio-list__head" role="row">
        {bulkEnabled ? (
          <div
            className="clients-portfolio-list__th clients-portfolio-list__th--check"
            role="columnheader"
          >
            <input
              type="checkbox"
              className="clients-portfolio-list__bulk-check"
              checked={allOnPageSelected}
              ref={(el) => {
                if (el) el.indeterminate = someOnPageSelected;
              }}
              onChange={() => onSelectAllOnPage?.()}
              aria-label="Tout sélectionner sur cette page"
              title="Tout sélectionner"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : null}
        <div className="clients-portfolio-list__th" role="columnheader">
          Dossier
        </div>
        <div className="clients-portfolio-list__th" role="columnheader">
          Statut
        </div>
        <div className="clients-portfolio-list__th" role="columnheader">
          Avancement / prochaine étape
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
          const isBulkSelected = idSet.has(rowId);
          const rowArchived = isLeadArchivedRecord(lead);

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
              {bulkEnabled ? (
                <div
                  className="clients-portfolio-list__cell clients-portfolio-list__cell--check"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="clients-portfolio-list__bulk-check"
                    checked={isBulkSelected}
                    onChange={() => onToggleBulkSelect?.(rowId)}
                    aria-label={`Sélectionner ${name}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : null}
              <div className="clients-portfolio-list__cell clients-portfolio-list__cell--name">
                <span className="clients-portfolio-list__name-row">
                  <span className="clients-portfolio-list__name">{name}</span>
                  <CrmLeadStatusBadge status={lead.status} stageName={lead.stage_name} />
                  {rowArchived ? (
                    <span className="sn-badge sn-badge-neutral" title="Dossier archivé">
                      ARCHIVÉ
                    </span>
                  ) : null}
                </span>
                {tel ? (
                  <span className="clients-portfolio-list__sub">{tel}</span>
                ) : null}
              </div>
              <div className="clients-portfolio-list__cell">
                {ps ? (
                  <span className={portfolioPipelineBadgeClass(psKey)} title={ps}>
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
