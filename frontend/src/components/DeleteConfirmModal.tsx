/**
 * DeleteConfirmModal — Modale de suppression contrôlée (soft delete).
 *
 * Affiche :
 *  - Nom de l'entité à supprimer
 *  - Nombre d'éléments liés (études, devis, factures, documents)
 *  - Champ de saisie du nom pour confirmation explicite
 *  - Message "30 jours pour restaurer"
 *
 * Utilisé pour la suppression de leads (et devis si besoin).
 */

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface LinkedItemCounts {
  studies: number;
  quotes: number;
  invoices: number;
  documents: number;
}

export interface DeleteConfirmModalProps {
  open: boolean;
  /** Nom affiché de l'entité (ex. full_name du lead) */
  entityName: string;
  /** Type lisible de l'entité (ex. "ce lead", "ce devis") */
  entityLabel?: string;
  /** Éléments liés — null = en cours de chargement */
  linkedCounts?: LinkedItemCounts | null;
  /** Désactiver le bouton pendant l'appel API */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function LinkedCountLine({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <li className="sn-delete-modal-linked-item">
      <span className="sn-delete-modal-linked-count">{count}</span>{" "}
      {label}
    </li>
  );
}

export function DeleteConfirmModal({
  open,
  entityName,
  entityLabel = "cet élément",
  linkedCounts,
  loading = false,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");

  const confirmed = typed.trim().toLowerCase() === entityName.trim().toLowerCase();

  const hasLinked =
    linkedCounts != null &&
    (linkedCounts.studies > 0 ||
      linkedCounts.quotes > 0 ||
      linkedCounts.invoices > 0 ||
      linkedCounts.documents > 0);

  useEffect(() => {
    if (!open) {
      setTyped("");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="sn-confirm-modal-backdrop"
      role="presentation"
    >
      <div
        className="sn-confirm-modal-panel sn-delete-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Header */}
        <div className="sn-confirm-modal-body">
          <div className="sn-confirm-modal-icon sn-confirm-modal-icon--danger" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </div>
          <div className="sn-confirm-modal-text">
            <h2 id={titleId} className="sn-confirm-modal-title">
              Supprimer {entityLabel}
            </h2>
            <p className="sn-confirm-modal-message">
              <strong>{entityName}</strong> sera supprimé et ses données personnelles anonymisées
              immédiatement.
            </p>
          </div>
        </div>

        {/* Éléments liés */}
        {linkedCounts === null && (
          <p className="sn-delete-modal-loading">Chargement des éléments liés…</p>
        )}
        {linkedCounts !== undefined && hasLinked && (
          <div className="sn-delete-modal-linked">
            <p className="sn-delete-modal-linked-title">
              Les éléments liés suivants seront aussi placés en corbeille&nbsp;:
            </p>
            <ul className="sn-delete-modal-linked-list">
              <LinkedCountLine count={linkedCounts.studies}   label={linkedCounts.studies   === 1 ? "étude"    : "études"} />
              <LinkedCountLine count={linkedCounts.quotes}    label={linkedCounts.quotes    === 1 ? "devis"    : "devis"} />
              <LinkedCountLine count={linkedCounts.invoices}  label={linkedCounts.invoices  === 1 ? "facture"  : "factures"} />
              <LinkedCountLine count={linkedCounts.documents} label={linkedCounts.documents === 1 ? "document" : "documents"} />
            </ul>
          </div>
        )}

        {/* Grace period notice */}
        <div className="sn-delete-modal-notice">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span>Vous avez <strong>30 jours</strong> pour restaurer {entityLabel} depuis la Corbeille admin.</span>
        </div>

        {/* Confirmation input */}
        <div className="sn-delete-modal-confirm-input">
          <label htmlFor={`${titleId}-input`} className="sn-delete-modal-input-label">
            Saisissez <strong>{entityName}</strong> pour confirmer
          </label>
          <input
            id={`${titleId}-input`}
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={entityName}
            className="sn-delete-modal-input"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Actions */}
        <div className="sn-confirm-modal-actions">
          <button
            type="button"
            className="sn-confirm-modal-btn sn-confirm-modal-btn--secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Annuler
          </button>
          <button
            type="button"
            className="sn-confirm-modal-btn sn-confirm-modal-btn--danger"
            onClick={onConfirm}
            disabled={!confirmed || loading}
          >
            {loading ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
