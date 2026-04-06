/**
 * CP-LEAD-V4 — Header ultra compact (1 ligne principale + contacts)
 */

import React from "react";
import { CYCLE_PROJECT_SELECT_OPTIONS } from "./constants";

export type LeadSaveSyncState = "idle" | "pending" | "saving" | "saved" | "error";

interface LeadHeaderProps {
  fullName: string;
  /** PRO : nom de l'entreprise (affiché comme titre principal) */
  companyName?: string;
  /** PRO : contact physique (affiché en sous-titre) */
  contactName?: string;
  customerType?: "PERSON" | "PRO";
  status: "LEAD" | "CLIENT";
  projectStatus: string;
  phone: string;
  email: string;
  commercialEmail: string;
  source: string;
  isLead: boolean;
  hasClientId: boolean;
  onBack: () => void;
  /** Cycle projet — intention de changement (confirm / modal DP refusé gérés par le parent) */
  onProjectStatusIntent: (status: string) => void;
  onStatusChange: (status: string) => void;
  /** Afficher le sélecteur de cycle projet (clients convertis uniquement) */
  showProjectCycle?: boolean;
  onRdvClick: () => void;
  statusSaving: boolean;
  saveSyncState: LeadSaveSyncState;
  onRetrySave?: () => void;
  /** Archiver / supprimer / désarchiver (droite header) */
  actions?: React.ReactNode;
  /** Lead archivé — badge + désactivation des sélecteurs type */
  isArchived?: boolean;
}

export default function LeadHeader({
  fullName,
  companyName,
  contactName,
  customerType,
  status,
  projectStatus,
  phone,
  email,
  commercialEmail,
  source,
  isLead,
  hasClientId,
  onBack,
  onProjectStatusIntent,
  onStatusChange,
  showProjectCycle,
  onRdvClick,
  statusSaving,
  saveSyncState,
  onRetrySave,
  actions,
  isArchived = false,
}: LeadHeaderProps) {
  const isPro = customerType === "PRO";
  const telHref = phone.replace(/\s/g, "");
  const cycleVisible = showProjectCycle ?? (!isLead && status === "CLIENT");

  const saveLabel = (() => {
    switch (saveSyncState) {
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
  })();

  const saveClass =
    saveSyncState === "saved" || saveSyncState === "idle"
      ? "crm-lead-save-pill crm-lead-save-pill--synced crm-lead-save-pill--compact crm-lead-save-pill--header"
      : saveSyncState === "pending"
        ? "crm-lead-save-pill crm-lead-save-pill--pending crm-lead-save-pill--compact crm-lead-save-pill--header"
        : saveSyncState === "saving"
          ? "crm-lead-save-pill crm-lead-save-pill--saving crm-lead-save-pill--compact crm-lead-save-pill--header"
          : "crm-lead-save-pill crm-lead-save-pill--error crm-lead-save-pill--compact crm-lead-save-pill--header";

  return (
    <header className="crm-lead-header-v4">
      <div className="crm-lead-header-v4-main">
        <button type="button" className="sn-btn sn-btn-ghost sn-btn-sm crm-lead-header-v4-back" onClick={onBack}>
          Retour
        </button>

        <div className="crm-lead-header-v4-identity">
          <h1 className="crm-lead-title crm-lead-title--compact" title={fullName || undefined}>
            <span className="crm-lead-title-text">{fullName || "Sans nom"}</span>
            {isPro && contactName ? (
              <span className="crm-lead-header-contact-sub"> — {contactName}</span>
            ) : null}
          </h1>
          {isArchived ? (
            <span className="crm-lead-badge crm-lead-badge--compact badge-archived">Archivé</span>
          ) : (
            <span
              className={`crm-lead-badge crm-lead-badge--compact ${status === "CLIENT" ? "crm-lead-badge-client" : "crm-lead-badge-lead"}`}
            >
              {status === "CLIENT" ? "Client" : "Lead"}
            </span>
          )}
          {isPro ? (
            <span className="crm-lead-badge-pro">PRO</span>
          ) : null}
          <div className={saveClass} aria-live="polite">
            <span className="crm-lead-save-dot" aria-hidden />
            <span className="crm-lead-save-label">{saveLabel}</span>
            {saveSyncState === "error" && onRetrySave ? (
              <button type="button" className="crm-lead-save-retry" onClick={onRetrySave}>
                Réessayer
              </button>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="crm-lead-header-v4-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        ) : null}

        <span className="crm-lead-header-v4-divider" aria-hidden />

        <div className="crm-lead-header-v4-selects">
          {cycleVisible ? (
            <select
              className="crm-lead-header-select-inline crm-lead-header-select-inline--pipeline"
              value={projectStatus}
              onChange={(e) => onProjectStatusIntent(e.target.value)}
              disabled={isArchived}
              aria-label="Cycle projet"
              title="Cycle projet"
            >
              {CYCLE_PROJECT_SELECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
          {isLead && !isArchived ? (
            <button
              type="button"
              className="crm-lead-header-convert-btn"
              onClick={() => onStatusChange("CLIENT")}
              disabled={statusSaving}
              title="Convertir ce lead en client"
            >
              {statusSaving ? "Conversion…" : "Convertir en client"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="crm-lead-header-v4-sub">
        <div className="crm-lead-header-v4-contacts">
          <div className="crm-lead-header-v4-contacts-row">
            {phone ? (
              <a className="crm-lead-header-contact-link" href={`tel:${telHref}`}>
                {phone}
              </a>
            ) : (
              <span className="crm-lead-header-contact-muted">—</span>
            )}
            <span className="crm-lead-header-v4-sep" aria-hidden>|</span>
            {email ? (
              <a className="crm-lead-header-contact-link" href={`mailto:${email}`}>
                {email}
              </a>
            ) : (
              <span className="crm-lead-header-contact-muted">—</span>
            )}
          </div>
          <div className="crm-lead-header-v4-contacts-row">
            <span className="crm-lead-header-contact-meta">
              <span className="crm-lead-header-contact-label">Commercial</span> {commercialEmail || "—"}
            </span>
            <span className="crm-lead-header-v4-sep" aria-hidden>|</span>
            <span className="crm-lead-header-contact-meta">
              <span className="crm-lead-header-contact-label">Source</span> {source || "—"}
            </span>
          </div>
        </div>
        {hasClientId ? (
          <button type="button" className="sn-btn sn-btn-outline sn-btn-sm crm-lead-header-v4-rdv" onClick={onRdvClick}>
            RDV
          </button>
        ) : null}
      </div>
    </header>
  );
}
