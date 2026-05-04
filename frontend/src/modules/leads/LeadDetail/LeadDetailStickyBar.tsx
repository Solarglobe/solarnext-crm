/**
 * Bandeau compact fixe lorsque la zone header + cockpit a défilé hors vue.
 */

import React from "react";
import { leadSaveSyncSnBadgeTone, type LeadSaveSyncState } from "./LeadHeader";
import { CrmLeadStatusBadge } from "../../../components/crm/CrmLeadStatusBadge";

export interface LeadDetailStickyBarProps {
  fullName: string;
  contactName?: string;
  customerType?: "PERSON" | "PRO";
  status: "LEAD" | "CLIENT";
  isArchived?: boolean;
  phone: string;
  source: string;
  saveSyncState: LeadSaveSyncState;
  onRetrySave?: () => void;
  onBack: () => void;
  /** Aligné sur ActionBar : masquer Nouvelle étude si étape SIGNED */
  showStudyButtons?: boolean;
  onStudyClick?: () => void;
  onCreateStudy?: () => void;
  createStudyLoading?: boolean;
  showConvert?: boolean;
  onConvert?: () => void;
  showRevertToLead?: boolean;
  onRevertToLead?: () => void;
  revertSaving?: boolean;
  statusSaving?: boolean;
  actions?: React.ReactNode;
  /** CP-078B — SUPER_ADMIN mode support lecture seule */
  readOnly?: boolean;
  leadStatusCode?: string | null;
  stageName?: string | null;
  stageCode?: string | null;
}

function saveLabel(state: LeadSaveSyncState): string {
  switch (state) {
    case "pending":
      return "En attente…";
    case "saving":
      return "Enregistrement…";
    case "saved":
      return "Enregistré";
    case "error":
      return "Erreur de sauvegarde";
    case "idle":
    default:
      return "À jour";
  }
}

export default function LeadDetailStickyBar({
  fullName,
  contactName,
  customerType,
  status,
  isArchived = false,
  phone,
  source,
  saveSyncState,
  onRetrySave,
  onBack,
  showStudyButtons,
  onStudyClick,
  onCreateStudy,
  createStudyLoading,
  showConvert,
  onConvert,
  showRevertToLead = false,
  onRevertToLead,
  revertSaving = false,
  statusSaving,
  actions,
  readOnly = false,
  leadStatusCode,
  stageName,
  stageCode,
}: LeadDetailStickyBarProps) {
  const isPro = customerType === "PRO";
  const telHref = phone.replace(/\s/g, "");
  const isLead = status !== "CLIENT" && !isArchived;

  return (
    <div className="crm-lead-sticky-bar" role="region" aria-label="Fiche lead — raccourcis">
      <div className="crm-lead-sticky-bar-inner">
        <button type="button" className="sn-btn sn-btn-ghost sn-btn-sm crm-lead-sticky-bar-back" onClick={onBack}>
          Retour
        </button>

        <div className="crm-lead-sticky-bar-identity">
          <h2 className="crm-lead-sticky-bar-title" title={fullName || undefined}>
            <span className="crm-lead-sticky-bar-title-text">{fullName || "Sans nom"}</span>
            {isPro && contactName ? (
              <span className="crm-lead-sticky-bar-contact"> — {contactName}</span>
            ) : null}
          </h2>
          {isArchived ? (
            <span className="sn-badge sn-badge-neutral">ARCHIVÉ</span>
          ) : (
            <CrmLeadStatusBadge
              status={leadStatusCode ?? (status === "CLIENT" ? "CLIENT" : "LEAD")}
              stageName={stageName}
              stageCode={stageCode}
              className="crm-status-badge--in-header"
            />
          )}
          {isPro ? <span className="sn-badge sn-badge-info">PRO</span> : null}

          <div className="crm-lead-save-indicator crm-lead-save-indicator--sticky" aria-live="polite">
            <span className={`sn-badge sn-badge-${leadSaveSyncSnBadgeTone(saveSyncState)}`}>
              {saveLabel(saveSyncState)}
            </span>
            {saveSyncState === "error" && onRetrySave ? (
              <button
                type="button"
                className="crm-lead-save-retry"
                disabled={readOnly}
                onClick={() => {
                  if (readOnly) return;
                  onRetrySave();
                }}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        </div>

        <p className="crm-lead-sticky-bar-meta">
          {phone.trim() ? (
            <a className="crm-lead-sticky-bar-meta-link" href={`tel:${telHref}`}>
              {phone.trim()}
            </a>
          ) : (
            <span className="crm-lead-sticky-bar-meta-muted">—</span>
          )}
          <span className="crm-lead-sticky-bar-meta-sep" aria-hidden>
            ·
          </span>
          <span className="crm-lead-sticky-bar-meta-rest" title={source || undefined}>
            {source.trim() || "—"}
          </span>
        </p>

        <div className="crm-lead-sticky-bar-actions">
          {isLead && onStudyClick ? (
            <button type="button" className="sn-btn sn-btn-outline-gold sn-btn-sm" onClick={onStudyClick}>
              Voir les études
            </button>
          ) : null}
          {isLead && showStudyButtons && onCreateStudy ? (
            <button
              type="button"
              className="sn-btn sn-btn-primary sn-btn-sm"
              disabled={createStudyLoading || readOnly}
              onClick={onCreateStudy}
            >
              {createStudyLoading ? "Création…" : "Nouvelle étude"}
            </button>
          ) : null}
          {showRevertToLead && onRevertToLead ? (
            <button
              type="button"
              className="sn-btn sn-btn-ghost sn-btn-sm"
              onClick={() => onRevertToLead()}
              disabled={revertSaving || readOnly}
            >
              {revertSaving ? "Rétablissement…" : "Revenir en lead"}
            </button>
          ) : null}
          {showConvert && onConvert ? (
            <button
              type="button"
              className="crm-lead-header-convert-btn crm-lead-sticky-bar-convert"
              onClick={() => onConvert()}
              disabled={statusSaving || readOnly}
            >
              {statusSaving ? "Conversion…" : "Convertir"}
            </button>
          ) : null}
          {actions ? <div className="crm-lead-sticky-bar-actions-extra">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}
