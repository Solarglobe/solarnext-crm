import { useState } from "react";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { ModalShell } from "../../../components/ui/ModalShell";
import { Button } from "../../../components/ui/Button";
import { useNavigate } from "react-router-dom";
import type { Study } from "../../../services/studies.service";
import { deleteStudy, duplicateStudy } from "../../../services/studies.service";
import {
  formatStudyPowerKw,
  formatStudyUpdatedAt,
  getStudyWorkflowBadge,
  studyCustomTitleSubtitle,
  workflowBadgeLabel,
  type StudyWorkflowBadge,
} from "./studyCardUtils";

function showStudyCardToast(message: string, isError: boolean) {
  const toast = document.createElement("div");
  toast.setAttribute("role", "alert");
  toast.className = isError ? "study-quote-toast study-quote-toast-error" : "study-quote-toast study-quote-toast-success";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

const WORKFLOW_BADGE_CLASS: Record<StudyWorkflowBadge, string> = {
  non_calc: "sn-badge sn-badge-neutral",
  calcule: "sn-badge sn-badge-info",
  devis: "sn-badge sn-badge-warn",
  signe: "sn-badge sn-badge-success",
};

type Props = {
  study: Study;
  onStudiesChange?: () => void | Promise<void>;
  onEditStudy?: (study: Study) => void;
  onOpenCalpinage?: (study: Study) => void;
  onOpenTechnicalQuote?: (study: Study) => void;
};

export function StudyCard({
  study,
  onStudiesChange,
  onEditStudy,
  onOpenCalpinage,
  onOpenTechnicalQuote,
}: Props) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicateTitleDraft, setDuplicateTitleDraft] = useState("");

  const badgeKey = getStudyWorkflowBadge(study);
  const workflowBadgeClass = WORKFLOW_BADGE_CLASS[badgeKey];
  const subtitle = studyCustomTitleSubtitle(study);
  const power = formatStudyPowerKw(study);
  const updated = formatStudyUpdatedAt(study.updated_at);

  const openStudy = () => {
    navigate(`/studies/${study.id}`);
  };

  const openDuplicateModal = () => {
    const base =
      study.title?.trim() ||
      (study.study_number != null ? String(study.study_number).trim() : "") ||
      study.id.slice(0, 8);
    setDuplicateTitleDraft(`${base} (copie)`);
    setDuplicateModalOpen(true);
  };

  const handleDuplicateSubmit = async () => {
    if (duplicating) return;
    const t = duplicateTitleDraft.trim();
    if (!t) {
      showStudyCardToast("Indiquez un nom pour la nouvelle étude.", true);
      return;
    }
    setDuplicating(true);
    try {
      await duplicateStudy(study.id, { title: t });
      showStudyCardToast("Étude dupliquée", false);
      setDuplicateModalOpen(false);
      await onStudiesChange?.();
    } catch (e) {
      showStudyCardToast(e instanceof Error ? e.message : "Duplication impossible", true);
    } finally {
      setDuplicating(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteStudy(study.id);
      showStudyCardToast("Étude supprimée", false);
      setConfirmOpen(false);
      await onStudiesChange?.();
    } catch (e) {
      showStudyCardToast(e instanceof Error ? e.message : "Suppression impossible", true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <article className="study-card-sg">
        <div className="study-card-sg-header-row">
          <div className="study-card-sg-title-block">
            <h3 className="study-card-sg-title">{study.study_number ?? study.id.slice(0, 8)}</h3>
            {subtitle ? <p className="study-card-sg-subtitle">{subtitle}</p> : null}
          </div>
          <div className="study-card-sg-icon-actions">
            {onEditStudy ? (
              <button
                type="button"
                className="study-card-sg-icon-btn"
                title="Changer le nom affiché sur la carte (même étude — pour une copie, utilisez « Dupliquer »)"
                aria-label="Changer le nom de l'étude"
                onClick={() => onEditStudy(study)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="study-card-sg-icon-btn study-card-sg-icon-btn--danger"
              title="Supprimer définitivement"
              aria-label="Supprimer définitivement"
              onClick={() => setConfirmOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>
        </div>

        <div className="study-card-sg-meta">
          <p className="study-card-sg-meta-line">
            <svg className="study-card-sg-meta-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Puissance installée : <strong>{power}</strong>
          </p>
          <p className="study-card-sg-meta-line">
            <svg className="study-card-sg-meta-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Dernière modification : <strong>{updated}</strong>
          </p>
        </div>

        <span className={`study-card-sg-workflow-slot ${workflowBadgeClass}`}>{workflowBadgeLabel(badgeKey)}</span>

        <div className="study-card-sg-actions">
          <button type="button" className="study-card-sg-btn-open" onClick={openStudy}>
            Ouvrir
          </button>
          {onOpenCalpinage ? (
            <button type="button" className="study-card-sg-btn-outline" onClick={() => onOpenCalpinage(study)}>
              Calpinage
            </button>
          ) : null}
          {onOpenTechnicalQuote ? (
            <button type="button" className="study-card-sg-btn-outline" onClick={() => onOpenTechnicalQuote(study)}>
              Devis technique
            </button>
          ) : null}
          <button
            type="button"
            className="study-card-sg-btn-outline"
            onClick={openDuplicateModal}
            disabled={duplicating}
          >
            Dupliquer
          </button>
        </div>
      </article>

      <ModalShell
        open={duplicateModalOpen}
        onClose={() => {
          if (!duplicating) setDuplicateModalOpen(false);
        }}
        size="sm"
        title="Dupliquer l'étude"
        subtitle="L’étude d’origine ne change pas. Saisissez le titre à afficher pour la nouvelle étude ; son contenu (version en cours, calpinage, éco) sera recopié."
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={duplicating}
              onClick={() => setDuplicateModalOpen(false)}
            >
              Annuler
            </Button>
            <Button type="button" variant="primary" disabled={duplicating} onClick={() => void handleDuplicateSubmit()}>
              {duplicating ? "Copie…" : "Créer la copie"}
            </Button>
          </>
        }
      >
        <label htmlFor="study-duplicate-input" style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}>
          Nom de la nouvelle étude
        </label>
        <input
          id="study-duplicate-input"
          className="sn-input"
          style={{ width: "100%", boxSizing: "border-box" }}
          value={duplicateTitleDraft}
          onChange={(e) => setDuplicateTitleDraft(e.target.value)}
          disabled={duplicating}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (!duplicating) void handleDuplicateSubmit();
          }}
          autoFocus
        />
      </ModalShell>

      <ConfirmModal
        open={confirmOpen}
        title="Supprimer définitivement cette étude ?"
        message="Cette action est irréversible."
        confirmLabel={deleting ? "Suppression…" : "Supprimer"}
        cancelLabel="Annuler"
        variant="danger"
        elevation="base"
        confirmDisabled={deleting}
        cancelDisabled={deleting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  );
}

export default StudyCard;
