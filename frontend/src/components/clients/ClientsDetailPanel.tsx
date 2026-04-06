/**
 * Panneau détail dossier projet PV — données Lead existantes, focus project_status.
 */

import React, { useCallback, useEffect, useState } from "react";
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
} from "../../modules/leads/LeadDetail/constants";
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

  const statusKey = normalizeStatusKey(ps);
  const currentIndex = STATUS_LIST.findIndex((s) => s.value === statusKey);
  const { start: rangeStart, end: rangeEnd } = getVisibleStepRange(currentIndex);
  const visibleSteps = STATUS_LIST.slice(rangeStart, rangeEnd);
  const showMoreBefore = rangeStart > 0;
  const showMoreAfter = rangeEnd < STATUS_LIST.length;

  useEffect(() => {
    setErr(null);
  }, [lead.id]);

  const handleStepClick = useCallback(
    (newStatus: string) => {
      const u = newStatus.trim().toUpperCase();
      if (u === statusKey) return;
      if (u === "DP_REFUSED") {
        setDpOpen(true);
        return;
      }
      setPendingStatus(u);
      setConfirmOpen(true);
    },
    [statusKey]
  );

  const applyPendingStatus = useCallback(async () => {
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
  }, [pendingStatus, statusKey, lead.id, onLeadUpdated, scheduleUndo]);

  const handleDpRefusedChoose = useCallback(
    async (choice: DPRefusedChoice) => {
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
    [lead, onLeadUpdated, scheduleUndo]
  );

  return (
    <div className="clients-detail clients-detail-panel">
      <div className="clients-detail__section clients-detail__section--identity">
        <div className="clients-detail__title-row">
          <h2 className="clients-detail__title">{name}</h2>
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
              const editable = canEditProjectStatus && !saving;

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
            onClick={() => onArchive(lead.id)}
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
    </div>
  );
}
