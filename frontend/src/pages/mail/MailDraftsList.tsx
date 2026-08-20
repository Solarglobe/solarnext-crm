/**
 * Liste des brouillons serveur (page Mail → dossier « Brouillons »).
 * Clic sur un brouillon → reprise dans le compositeur ; suppression possible.
 */

import { useCallback, useState } from "react";
import type { MailDraftRow } from "../../services/mailApi";
import { deleteMailDraft, resolveMailDraftConflict } from "../../services/mailApi";

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

function draftSyncLabel(draft: MailDraftRow): string {
  const status = draft.sync_status || "LOCAL_ONLY";
  if (status === "SYNCED") return "Synchronisé Outlook";
  if (status === "QUEUED" || status === "SYNCING") return "Enregistrement Outlook…";
  if (status === "CONFLICT") return "Conflit";
  if (status === "DELETE_QUEUED") return "Suppression distante…";
  if (status === "ERROR" || status === "OFFLINE") return "Hors ligne";
  return "Local";
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
                <span className="mail-drafts__date">{draftSyncLabel(d)} · {formatDraftDate(d.updated_at)}</span>
              </span>
              {d.conflict_reason || d.sync_error ? (
                <span className="mail-drafts__sync-warning">{d.conflict_reason || d.sync_error}</span>
              ) : null}
              <span className="mail-drafts__line2">
                {d.to.trim() ? <span className="mail-drafts__to">À : {d.to}</span> : <span className="mail-drafts__to mail-drafts__to--empty">Sans destinataire</span>}
                <span className="mail-drafts__preview">{htmlToPreviewText(d.body_html)}</span>
              </span>
            </button>
            {d.sync_status === "CONFLICT" ? (
              <div className="mail-drafts__conflict-actions" aria-label="Résoudre le conflit">
                <button type="button" onClick={() => void resolveMailDraftConflict(d.id, "use_local").then(() => onDraftDeleted("__refresh__"))}>
                  Version CRM
                </button>
                <button type="button" onClick={() => void resolveMailDraftConflict(d.id, "use_remote").then(() => onDraftDeleted("__refresh__"))}>
                  Version Outlook
                </button>
                <button type="button" onClick={() => void resolveMailDraftConflict(d.id, "keep_both").then(() => onDraftDeleted("__refresh__"))}>
                  Garder les deux
                </button>
              </div>
            ) : null}
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
