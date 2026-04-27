/**
 * Panneau détail dossier projet PV — données Lead existantes, focus project_status.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Lead } from "../../services/leads.service";
import {
  getLeadFullAddress,
  getLeadName,
  getLeadPhoneDisplay,
  updateLead,
  type ProjectStatus,
} from "../../services/leads.service";
import {
  CYCLE_PROJECT_SELECT_OPTIONS,
  PROJECT_CYCLE_LABELS,
  isLeadDpFolderAccessible,
} from "../../modules/leads/LeadDetail/constants";
import { CrmLeadStatusBadge } from "../crm/CrmLeadStatusBadge";
import { ConfirmModal } from "../ui/ConfirmModal";
import { UndoToast } from "../ui/UndoToast";
import { useUndoAction } from "../../hooks/useUndoAction";
import { DPRefusedModal } from "../../modules/leads/DPRefusedModal";
import {
  buildDpRefusedPatch,
  ACTIVITY_TAG_DP_RETRY_LATER,
  type DPRefusedChoice,
} from "../../modules/leads/dpRefusedStatus";
import { createActivity } from "../../services/activities.service";
import {
  formatSignatureDate,
  formatUpdatedAtRelative,
  getProjectTracking,
  isMairieOrDpPending,
} from "./projectPvTracking";
import { formatDateFR } from "../../utils/date.utils";
import { VisiteTechniqueModal } from "../visiteTechnique/VisiteTechniqueModal";
import { useSuperAdminReadOnly } from "../../contexts/OrganizationContext";
import { fetchStudiesByLeadId } from "../../services/studies.service";
import { fetchQuotesList } from "../../services/financial.api";
import { fetchMissionsByClientId } from "../../services/missions.service";
import { getInbox } from "../../services/mailApi";
import { Button } from "../ui/Button";

const STATUS_LIST = CYCLE_PROJECT_SELECT_OPTIONS;

function normalizeStatusKey(ps: string | undefined): string {
  return (ps ?? "").trim().toUpperCase();
}

/** Fenêtre [start, end) autour du statut courant (max 3 étapes visibles). */
function getVisibleStepRange(currentIndex: number): { start: number; end: number } {
  const n = STATUS_LIST.length;
  if (n === 0) return { start: 0, end: 0 };
  const idx = currentIndex < 0 ? 0 : currentIndex;
  if (idx <= 0) {
    return { start: 0, end: Math.min(3, n) };
  }
  if (idx >= n - 1) {
    return { start: Math.max(0, n - 3), end: n };
  }
  return { start: idx - 1, end: idx + 2 };
}

export interface ClientsDetailPanelProps {
  lead: Lead | null;
  canArchive: boolean;
  /** Autorise l’édition du statut projet (PATCH) — aligné permissions lead.update.* */
  canEditProjectStatus?: boolean;
  onOpenFull: (id: string) => void;
  onArchive?: (id: string) => void | Promise<void>;
  /** Après PATCH réussi — fusionner le lead dans la liste parent */
  onLeadUpdated?: (lead: Lead) => void;
  /** Fermer le panneau détail et revenir à la liste pleine largeur */
  onClose?: () => void;
}

export function ClientsDetailPanel({
  lead,
  canArchive,
  canEditProjectStatus = true,
  onOpenFull,
  onArchive,
  onLeadUpdated,
  onClose,
}: ClientsDetailPanelProps) {
  if (!lead) {
    return null;
  }

  return (
    <ClientsDetailPanelBody
      lead={lead}
      canArchive={canArchive}
      canEditProjectStatus={canEditProjectStatus}
      onOpenFull={onOpenFull}
      onArchive={onArchive}
      onLeadUpdated={onLeadUpdated}
      onClose={onClose}
    />
  );
}

function ClientsDetailPanelBody({
  lead,
  canArchive,
  canEditProjectStatus,
  onOpenFull,
  onArchive,
  onLeadUpdated,
  onClose,
}: {
  lead: Lead;
  canArchive: boolean;
  canEditProjectStatus: boolean;
  onOpenFull: (id: string) => void;
  onArchive?: (id: string) => void | Promise<void>;
  onLeadUpdated?: (lead: Lead) => void;
  onClose?: () => void;
}) {
  const name = getLeadName(lead);
  const phone = getLeadPhoneDisplay(lead);
  const email = lead.email?.trim();
  const address = getLeadFullAddress(lead);
  const ps = lead.project_status;
  const tracking = getProjectTracking(lead);
  const act = formatUpdatedAtRelative(lead);
  const waitHeavy = ps ? isMairieOrDpPending(ps) : false;

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { scheduleUndo, activeToast } = useUndoAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [dpOpen, setDpOpen] = useState(false);
  const [dpBusy, setDpBusy] = useState(false);
  const [birthSaving, setBirthSaving] = useState(false);
  const [isVisiteOpen, setIsVisiteOpen] = useState(false);
  const [quickStats, setQuickStats] = useState<{
    studies: number;
    quotes: number;
    emails: number;
    rdv: number;
  } | null>(null);
  const [quickStatsLoading, setQuickStatsLoading] = useState(true);
  const navigate = useNavigate();
  const isReadOnly = useSuperAdminReadOnly();

  const openVisiteTechnique = useCallback(() => setIsVisiteOpen(true), []);

  useEffect(() => {
    let cancelled = false;
    const id = lead.id;
    const cid = lead.client_id ?? null;
    setQuickStatsLoading(true);
    (async () => {
      try {
        const [studiesR, quotesR, missionsR, inboxR] = await Promise.allSettled([
          fetchStudiesByLeadId(id),
          fetchQuotesList({ lead_id: id, limit: 500 }),
          cid ? fetchMissionsByClientId(cid) : Promise.resolve([]),
          getInbox({ leadId: id, limit: 1 }),
        ]);
        if (cancelled) return;
        const studies = studiesR.status === "fulfilled" ? studiesR.value.length : 0;
        const quotes = quotesR.status === "fulfilled" ? quotesR.value.length : 0;
        const rdv = missionsR.status === "fulfilled" ? missionsR.value.length : 0;
        const emails = inboxR.status === "fulfilled" ? inboxR.value.total : 0;
        setQuickStats({ studies, quotes, emails, rdv });
      } catch {
        if (!cancelled) {
          setQuickStats({ studies: 0, quotes: 0, emails: 0, rdv: 0 });
        }
      } finally {
        if (!cancelled) setQuickStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead.id, lead.client_id]);
  const closeVisiteTechnique = useCallback(() => setIsVisiteOpen(false), []);

  const statusKey = normalizeStatusKey(ps);
  const currentIndex = STATUS_LIST.findIndex((s) => s.value === statusKey);
  const { start: rangeStart, end: rangeEnd } = getVisibleStepRange(currentIndex);
  const visibleSteps = STATUS_LIST.slice(rangeStart, rangeEnd);
  const showMoreBefore = rangeStart > 0;
  const showMoreAfter = rangeEnd < STATUS_LIST.length;

  useEffect(() => {
    setErr(null);
  }, [lead.id]);

  const handleBirthDateChange = useCallback(
    async (value: string) => {
      if (isReadOnly) return;
      const next = value ? value : null;
      const prev = lead.birth_date ?? null;
      if (next === prev) return;
      setErr(null);
      setBirthSaving(true);
      try {
        const updated = await updateLead({
          id: lead.id,
          birth_date: next,
        });
        onLeadUpdated?.(updated);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur de mise à jour");
      } finally {
        setBirthSaving(false);
      }
    },
    [isReadOnly, lead.birth_date, lead.id, onLeadUpdated]
  );

  const handleStepClick = useCallback(
    (newStatus: string) => {
      if (isReadOnly) return;
      const u = newStatus.trim().toUpperCase();
      if (u === statusKey) return;
      if (u === "DP_REFUSED") {
        setDpOpen(true);
        return;
      }
      setPendingStatus(u);
      setConfirmOpen(true);
    },
    [isReadOnly, statusKey]
  );

  const applyPendingStatus = useCallback(async () => {
    if (isReadOnly) return;
    if (!pendingStatus) return;
    const prev = statusKey;
    const next = pendingStatus;
    setConfirmOpen(false);
    setPendingStatus(null);
    setErr(null);
    setSaving(true);
    try {
      await scheduleUndo({
        previousState: prev,
        execute: async () => {
          const updated = await updateLead({
            id: lead.id,
            project_status: next as ProjectStatus,
          });
          onLeadUpdated?.(updated);
        },
        rollback: async () => {
          const updated = await updateLead({
            id: lead.id,
            project_status: prev as ProjectStatus,
          });
          onLeadUpdated?.(updated);
        },
        message: "Statut mis à jour",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur de mise à jour");
    } finally {
      setSaving(false);
    }
  }, [isReadOnly, pendingStatus, statusKey, lead.id, onLeadUpdated, scheduleUndo]);

  const handleDpRefusedChoose = useCallback(
    async (choice: DPRefusedChoice) => {
      if (isReadOnly) return;
      setDpBusy(true);
      setErr(null);
      try {
        const snap = {
          status: lead.status,
          project_status: lead.project_status ?? null,
          lost_reason: lead.lost_reason ?? null,
        };
        const patch = buildDpRefusedPatch(choice);
        await scheduleUndo({
          previousState: snap,
          execute: async () => {
            const updated = await updateLead({
              id: lead.id,
              ...patch,
            } as Parameters<typeof updateLead>[0]);
            onLeadUpdated?.(updated);
            if (choice === "attente") {
              await createActivity(lead.id, {
                type: "NOTE",
                title: "DP refusé — mise en attente",
                content: "Tag DP_RETRY_LATER — suivi différé.",
                payload: { tag: ACTIVITY_TAG_DP_RETRY_LATER },
              });
            }
          },
          rollback: async () => {
            const updated = await updateLead({
              id: lead.id,
              status: snap.status,
              project_status: snap.project_status ?? "SIGNE",
              lost_reason: snap.lost_reason,
            });
            onLeadUpdated?.(updated);
          },
          message:
            choice === "perdu" ? "Dossier classé en perdu" : "Statut mis à jour",
        });
        setDpOpen(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erreur de mise à jour");
      } finally {
        setDpBusy(false);
      }
    },
    [isReadOnly, lead, onLeadUpdated, scheduleUndo]
  );

  return (
    <div className="clients-detail clients-detail-panel">
      <div
        className="clients-detail-quick-stats"
        role="region"
        aria-label="Synthèse du dossier"
      >
        <div className="clients-detail-quick-stats__item">
          <span className="clients-detail-quick-stats__n" aria-hidden={quickStatsLoading}>
            {quickStatsLoading ? "…" : (quickStats?.studies ?? "—")}
          </span>
          <span className="clients-detail-quick-stats__lbl">Études</span>
        </div>
        <div className="clients-detail-quick-stats__item">
          <span className="clients-detail-quick-stats__n" aria-hidden={quickStatsLoading}>
            {quickStatsLoading ? "…" : (quickStats?.quotes ?? "—")}
          </span>
          <span className="clients-detail-quick-stats__lbl">Devis</span>
        </div>
        <div className="clients-detail-quick-stats__item">
          <span className="clients-detail-quick-stats__n" aria-hidden={quickStatsLoading}>
            {quickStatsLoading ? "…" : (quickStats?.emails ?? "—")}
          </span>
          <span className="clients-detail-quick-stats__lbl">E-mails</span>
        </div>
        <div className="clients-detail-quick-stats__item">
          <span className="clients-detail-quick-stats__n" aria-hidden={quickStatsLoading}>
            {quickStatsLoading ? "…" : (quickStats?.rdv ?? "—")}
          </span>
          <span className="clients-detail-quick-stats__lbl">RDV</span>
        </div>
      </div>

      <div className="clients-detail__section" style={{ paddingTop: 0, paddingBottom: 4 }}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isReadOnly}
          title={isReadOnly ? "Lecture seule" : undefined}
          onClick={() => {
            const href = lead.client_id
              ? `/invoices/new?clientId=${encodeURIComponent(lead.client_id)}`
              : `/invoices/new?leadId=${encodeURIComponent(lead.id)}`;
            navigate(href);
          }}
        >
          Créer une facture
        </Button>
      </div>

      <div className="clients-detail__section clients-detail__section--identity">
        <div className="clients-detail__title-row">
          <div className="clients-detail__title-inner">
            <h2 className="clients-detail__title">{name}</h2>
            <CrmLeadStatusBadge
              status={lead.status}
              stageName={lead.stage_name}
              className="crm-status-badge--in-header"
            />
          </div>
          {onClose && (
            <button
              type="button"
              className="clients-detail__close-btn"
              onClick={onClose}
              aria-label="Fermer le détail"
              title="Fermer"
            >
              ×
            </button>
          )}
        </div>
        <dl className="clients-detail__dl">
          {phone ? (
            <div className="clients-detail__row">
              <dt>Téléphone</dt>
              <dd>{phone}</dd>
            </div>
          ) : null}
          {email ? (
            <div className="clients-detail__row">
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
          ) : null}
          <div className="clients-detail__row clients-detail__row--birth">
            <dt title="Mandat de représentation (DP)">Naissance</dt>
            <dd>
              {canEditProjectStatus ? (
                <input
                  type="date"
                  className="sn-input clients-detail__birth-input"
                  disabled={birthSaving || saving || isReadOnly}
                  value={
                    lead.birth_date
                      ? String(lead.birth_date).slice(0, 10)
                      : ""
                  }
                  onChange={(e) => {
                    void handleBirthDateChange(e.target.value);
                  }}
                  aria-label="Date de naissance pour le mandat de représentation"
                />
              ) : (
                formatDateFR(lead.birth_date) ?? "Non renseignée"
              )}
            </dd>
          </div>
          {address ? (
            <div className="clients-detail__row">
              <dt>Chantier</dt>
              <dd>{address}</dd>
            </div>
          ) : null}
          <div className="clients-detail__row">
            <dt>Signature</dt>
            <dd>{formatSignatureDate(lead)}</dd>
          </div>
        </dl>
      </div>

      <div className="clients-detail__section">
        <div className="project-status-container">
          <div className="project-status-header">
            <span>Statut projet</span>
          </div>

          <div
            className="project-status-stepper"
            role="group"
            aria-label="Étapes du cycle projet"
          >
            {showMoreBefore ? (
              <div className="step more" aria-hidden="true">
                ...
              </div>
            ) : null}

            {visibleSteps.map((s) => {
              const stepIndex = STATUS_LIST.findIndex((x) => x.value === s.value);
              const isCurrent =
                currentIndex >= 0 && s.value === statusKey;
              const isPast = currentIndex >= 0 && stepIndex < currentIndex;
              const editable = canEditProjectStatus && !saving && !isReadOnly;

              return (
                <button
                  key={s.value}
                  type="button"
                  className={`step${isCurrent ? " current" : ""}${isPast ? " past" : ""}${!editable ? " step--readonly" : ""}`}
                  disabled={!editable}
                  onClick={() => handleStepClick(s.value)}
                  title={
                    editable
                      ? `Passer à : ${s.label}`
                      : s.label
                  }
                >
                  <div className="dot" />
                  <span>{s.label}</span>
                </button>
              );
            })}

            {showMoreAfter ? (
              <div className="step more" aria-hidden="true">
                ...
              </div>
            ) : null}
          </div>
        </div>

        {err ? (
          <p className="clients-detail__status-err" role="alert">
            {err}
          </p>
        ) : null}

        <div className="progress-line clients-detail__progress-line">
          <div className="progress-bar progress-bar--detail">
            <div
              className="progress-fill"
              style={{ width: `${tracking.progress}%` }}
            />
          </div>
          <div className="progress-meta">
            <span className="percent">{tracking.progress}%</span>
            <span className="text">{tracking.nextStep}</span>
          </div>
        </div>

        {waitHeavy ? (
          <p className="clients-detail__hint">
            Dossier en phase administrative ou attente tiers — surveiller les
            délais.
          </p>
        ) : null}
      </div>

      <div className="clients-detail__section">
        <h3 className="clients-detail__h3">Activité</h3>
        <p
          className={`clients-detail__activity${act.warn ? " clients-detail__activity--warn" : ""}`}
        >
          Dernière activité : {act.text}
          {act.warn ? " — relancer si nécessaire." : ""}
        </p>
        {lead.assigned_to_email ? (
          <p className="clients-detail__owner">
            <span className="clients-detail__owner-label">Responsable suivi</span>
            {lead.assigned_to_email}
          </p>
        ) : null}
      </div>

      <div className="clients-detail__actions">
        {isLeadDpFolderAccessible(lead) ? (
          <button
            type="button"
            className="sn-btn sn-btn-primary sn-btn-sm"
            disabled={isReadOnly}
            onClick={() => {
              if (isReadOnly) return;
              navigate(`/leads/${lead.id}/dp`);
            }}
          >
            Créer / Continuer le dossier DP
          </button>
        ) : null}
        <button
          type="button"
          className="sn-btn sn-btn-primary sn-btn-sm"
          disabled={isReadOnly}
          onClick={() => {
            if (isReadOnly) return;
            openVisiteTechnique();
          }}
        >
          Visite technique
        </button>
        <button
          type="button"
          className="sn-btn sn-btn-primary sn-btn-sm"
          onClick={() => onOpenFull(lead.id)}
        >
          Ouvrir la fiche complète
        </button>
        {canArchive && onArchive ? (
          <button
            type="button"
            className="sn-btn sn-btn-ghost sn-btn-sm clients-detail__archive"
            disabled={isReadOnly}
            onClick={() => {
              if (isReadOnly) return;
              onArchive(lead.id);
            }}
          >
            Archiver le dossier
          </button>
        ) : null}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Confirmer le changement de statut"
        message={
          pendingStatus
            ? `Passer le cycle projet à « ${PROJECT_CYCLE_LABELS[pendingStatus] ?? pendingStatus.replace(/_/g, " ")} » ?`
            : ""
        }
        confirmLabel="Confirmer"
        cancelLabel="Annuler"
        variant="warning"
        onCancel={() => {
          setConfirmOpen(false);
          setPendingStatus(null);
        }}
        onConfirm={() => void applyPendingStatus()}
      />

      <DPRefusedModal
        open={dpOpen}
        busy={dpBusy}
        onClose={() => !dpBusy && setDpOpen(false)}
        onChoose={handleDpRefusedChoose}
      />

      {activeToast ? (
        <UndoToast
          message={activeToast.message}
          secondsLeft={activeToast.secondsLeft}
          onUndo={activeToast.onUndo}
          onPauseChange={activeToast.onHoverPause}
        />
      ) : null}

      <VisiteTechniqueModal
        key={String(lead.id)}
        open={isVisiteOpen}
        onClose={closeVisiteTechnique}
        clientId={String(lead.id)}
      />
    </div>
  );
}
