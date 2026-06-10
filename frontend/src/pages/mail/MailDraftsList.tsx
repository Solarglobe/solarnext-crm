/**
 * Liste des brouillons serveur (page Mail → dossier « Brouillons »).
 * Clic sur un brouillon → reprise dans le compositeur ; suppression possible.
 */

import { useCallback, useState } from "react";
import type { MailDraftRow } from "../../services/mailApi";
import { deleteMailDraft } from "../../services/mailApi";

function htmlToPreviewText(html: string, max = 140): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  const txt = (d.textContent || "").replace(/\s+/g, " ").trim();
  return txt.length > max ? `${txt.slice(0, max)}…` : txt;
}

function formatDraftDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const now = new Date();
  const sameDay =
    dt.getFullYear() === now.getFullYear() &&
    dt.getMonth() === now.getMonth() &&
    dt.getDate() === now.getDate();
  return sameDay
    ? dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

export interface MailDraftsListProps {
  drafts: MailDraftRow[];
  loading: boolean;
  error: string | null;
  onOpenDraft: (draft: MailDraftRow) => void;
  onDraftDeleted: (id: string) => void;
}

export function MailDraftsList({ drafts, loading, error, onOpenDraft, onDraftDeleted }: MailDraftsListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleteError(null);
      setDeletingId(id);
      try {
        await deleteMailDraft(id);
        onDraftDeleted(id);
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingId(null);
      }
    },
    [onDraftDeleted]
  );

  if (loading && drafts.length === 0) {
    return <p className="mail-drafts__hint">Chargement des brouillons…</p>;
  }
  if (error) {
    return <div className="mail-inbox__error">{error}</div>;
  }
  if (drafts.length === 0) {
    return (
      <p className="mail-drafts__hint">
        Aucun brouillon. Un nouveau message fermé sans être envoyé est enregistré ici automatiquement.
      </p>
    );
  }

  return (
    <div className="mail-drafts">
      {deleteError && <div className="mail-inbox__error">{deleteError}</div>}
      <ul className="mail-drafts__list">
        {drafts.map((d) => (
          <li key={d.id} className="mail-drafts__item">
            <button
              type="button"
              className="mail-drafts__open"
              onClick={() => onOpenDraft(d)}
              title="Reprendre ce brouillon"
            >
              <span className="mail-drafts__line1">
                <span className="mail-drafts__subject">{d.subject.trim() || "(Sans objet)"}</span>
                <span className="mail-drafts__date">{formatDraftDate(d.updated_at)}</span>
              </span>
              <span className="mail-drafts__line2">
                {d.to.trim() ? <span className="mail-drafts__to">À : {d.to}</span> : <span className="mail-drafts__to mail-drafts__to--empty">Sans destinataire</span>}
                <span className="mail-drafts__preview">{htmlToPreviewText(d.body_html)}</span>
              </span>
            </button>
            <button
              type="button"
              className="mail-drafts__delete"
              onClick={() => void handleDelete(d.id)}
              disabled={deletingId === d.id}
              aria-label="Supprimer le brouillon"
              title="Supprimer le brouillon"
            >
              {deletingId === d.id ? "…" : "✕"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
