/**
 * CP-LEAD-V4 — Header ultra compact (1 ligne principale + contacts)
 */

import React from "react";
import { CYCLE_PROJECT_SELECT_OPTIONS } from "./constants";
import { CrmLeadStatusBadge } from "../../../components/crm/CrmLeadStatusBadge";

export type LeadSaveSyncState = "idle" | "pending" | "saving" | "saved" | "error";

/** Variante `sn-badge` pour l’état de synchro formulaire (Phase 3 — badges unifiés). */
export function leadSaveSyncSnBadgeTone(state: LeadSaveSyncState): "success" | "warn" | "danger" {
  if (state === "saved" || state === "idle") return "success";
  if (state === "error") return "danger";
  return "warn";
}

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
  /** Afficher « Revenir en lead » (clients actifs) */
  showRevertToLead?: boolean;
  onRevertToLead?: () => void;
  revertSaving?: boolean;
  onRdvClick: () => void;
  statusSaving: boolean;
  saveSyncState: LeadSaveSyncState;
  onRetrySave?: () => void;
  /** Archiver / supprimer / désarchiver (droite header) */
  actions?: React.ReactNode;
  /** Lead archivé — badge + désactivation des sélecteurs type */
  isArchived?: boolean;
  /** CP-078B — SUPER_ADMIN mode support lecture seule */
  readOnly?: boolean;
  /** E-mail : ouvrir le composeur CRM (si boîte connectée) ou mailto — défini par la page */
  onWriteEmail?: () => void;
  /** Statut CRM API + pipeline — badge couleur unifié */
  leadStatusCode?: string | null;
  stageName?: string | null;
  stageCode?: string | null;
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
  showRevertToLead = false,
  onRevertToLead,
  revertSaving = false,
  onRdvClick,
  statusSaving,
  saveSyncState,
  onRetrySave,
  actions,
  isArchived = false,
  readOnly = false,
  onWriteEmail,
  leadStatusCode,
  stageName,
  stageCode,
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

  const syncTone = leadSaveSyncSnBadgeTone(saveSyncState);

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
            <span className="sn-badge sn-badge-neutral">ARCHIVÉ</span>
          ) : (
            <CrmLeadStatusBadge
              status={leadStatusCode ?? (status === "CLIENT" ? "CLIENT" : "LEAD")}
              stageName={stageName}
              stageCode={stageCode}
              className="crm-status-badge--in-header"
            />
          )}
          {isPro ? (
            <span className="sn-badge sn-badge-info">PRO</span>
          ) : null}
          <div className="crm-lead-save-indicator crm-lead-save-indicator--header" aria-live="polite">
            <span className={`sn-badge sn-badge-${syncTone}`}>{saveLabel}</span>
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
              disabled={isArchived || readOnly}
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
          {showRevertToLead && onRevertToLead && !isArchived ? (
            <button
              type="button"
              className="sn-btn sn-btn-ghost sn-btn-sm"
              onClick={() => onRevertToLead()}
              disabled={revertSaving || readOnly}
              title="Remettre le dossier en lead (liste Leads uniquement)"
            >
              {revertSaving ? "Rétablissement…" : "Revenir en lead"}
            </button>
          ) : null}
          {isLead && !isArchived ? (
            <button
              type="button"
              className="crm-lead-header-convert-btn"
              onClick={() => onStatusChange("CLIENT")}
              disabled={statusSaving || readOnly}
              title="Convertir ce lead en client"
            >
              {statusSaving ? "Conversion…" : "Convertir en client"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="crm-lead-header-v4-sub">
        <div className="crm-lead-header-v4-contacts">
          <div className="crm-lead-header-v4-contacts-row crm-lead-header-v4-contacts-row--mail">
            {phone ? (
              <a className="crm-lead-header-contact-link" href={`tel:${telHref}`}>
                {phone}
              </a>
            ) : (
              <span className="crm-lead-header-contact-muted">—</span>
            )}
            <span className="crm-lead-header-v4-sep" aria-hidden>|</span>
            {email ? (
              <>
                <span className="crm-lead-header-contact-text" title={email}>
                  {email}
                </span>
                {onWriteEmail ? (
                  <button
                    type="button"
                    className="sn-btn sn-btn-primary sn-btn-sm crm-lead-header-write-btn"
                    disabled={readOnly}
                    onClick={() => {
                      if (readOnly) return;
                      onWriteEmail();
                    }}
                  >
                    📨 Écrire
                  </button>
                ) : null}
              </>
            ) : (
              <span className="crm-lead-header-contact-muted">—</span>
            )}
          </div>
          {email && onWriteEmail ? (
            <p className="crm-lead-header-mail-hint">Envoyer depuis votre boîte CRM</p>
          ) : null}
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
          <button
            type="button"
            className="sn-btn sn-btn-outline sn-btn-sm crm-lead-header-v4-rdv"
            disabled={readOnly}
            onClick={() => {
              if (readOnly) return;
              onRdvClick();
            }}
          >
            RDV
          </button>
        ) : null}
      </div>
    </header>
  );
}
