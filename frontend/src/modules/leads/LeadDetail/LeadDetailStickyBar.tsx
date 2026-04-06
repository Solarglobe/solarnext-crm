/**
 * Bandeau compact fixe lorsque la zone header + cockpit a défilé hors vue.
 */

import React from "react";
import type { LeadSaveSyncState } from "./LeadHeader";

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
  statusSaving?: boolean;
  actions?: React.ReactNode;
}

function savePillClass(state: LeadSaveSyncState): string {
  if (state === "saved" || state === "idle") {
    return "crm-lead-save-pill crm-lead-save-pill--synced crm-lead-save-pill--compact crm-lead-save-pill--sticky";
  }
  if (state === "pending") {
    return "crm-lead-save-pill crm-lead-save-pill--pending crm-lead-save-pill--compact crm-lead-save-pill--sticky";
  }
  if (state === "saving") {
    return "crm-lead-save-pill crm-lead-save-pill--saving crm-lead-save-pill--compact crm-lead-save-pill--sticky";
  }
  return "crm-lead-save-pill crm-lead-save-pill--error crm-lead-save-pill--compact crm-lead-save-pill--sticky";
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
  statusSaving,
  actions,
}: LeadDetailStickyBarProps) {
  const isPro = customerType === "PRO";
  const telHref = phone.replace(/\s/g, "");
  const isLead = status === "LEAD" && !isArchived;

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
            <span className="crm-lead-badge crm-lead-badge--compact badge-archived">Archivé</span>
          ) : (
            <span
              className={`crm-lead-badge crm-lead-badge--compact ${status === "CLIENT" ? "crm-lead-badge-client" : "crm-lead-badge-lead"}`}
            >
              {status === "CLIENT" ? "Client" : "Lead"}
            </span>
          )}
          {isPro ? <span className="crm-lead-badge-pro">PRO</span> : null}

          <div className={savePillClass(saveSyncState)} aria-live="polite">
            <span className="crm-lead-save-dot" aria-hidden />
            <span className="crm-lead-save-label">{saveLabel(saveSyncState)}</span>
            {saveSyncState === "error" && onRetrySave ? (
              <button type="button" className="crm-lead-save-retry" onClick={onRetrySave}>
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
              disabled={createStudyLoading}
              onClick={onCreateStudy}
            >
              {createStudyLoading ? "Création…" : "Nouvelle étude"}
            </button>
          ) : null}
          {showConvert && onConvert ? (
            <button
              type="button"
              className="crm-lead-header-convert-btn crm-lead-sticky-bar-convert"
              onClick={() => onConvert()}
              disabled={statusSaving}
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
