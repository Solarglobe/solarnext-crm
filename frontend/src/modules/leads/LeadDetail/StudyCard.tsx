import { useState } from "react";
import { ConfirmModal } from "../../../components/ui/ConfirmModal";
import { useNavigate } from "react-router-dom";
import type { Study } from "../../../services/studies.service";
import { deleteStudy } from "../../../services/studies.service";
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

const BADGE_STYLES: Record<StudyWorkflowBadge, { bg: string; color: string }> = {
  non_calc: { bg: "rgba(148, 163, 184, 0.22)", color: "var(--text-muted)" },
  calcule: { bg: "rgba(59, 130, 246, 0.2)", color: "#2563eb" },
  devis: { bg: "rgba(139, 92, 246, 0.22)", color: "#7c3aed" },
  signe: { bg: "rgba(34, 197, 94, 0.2)", color: "#16a34a" },
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

  const badgeKey = getStudyWorkflowBadge(study);
  const badge = BADGE_STYLES[badgeKey];
  const subtitle = studyCustomTitleSubtitle(study);
  const power = formatStudyPowerKw(study);
  const updated = formatStudyUpdatedAt(study.updated_at);

  const openStudy = () => {
    navigate(`/studies/${study.id}`);
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
                title="Modifier l'étude"
                aria-label="Modifier l'étude"
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

        <span className="study-card-sg-badge" style={{ background: badge.bg, color: badge.color }}>
          {workflowBadgeLabel(badgeKey)}
        </span>

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
        </div>
      </article>

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
