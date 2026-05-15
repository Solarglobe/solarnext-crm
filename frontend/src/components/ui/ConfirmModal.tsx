import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./confirm-modal.css";

export type ConfirmModalVariant = "danger" | "warning" | "default";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ConfirmModalVariant;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Par défaut `false` (Lot 1) : fermeture uniquement via boutons explicites ou Escape.
   */
  closeOnBackdropClick?: boolean;
  /**
   * `base` : au-dessus du contenu page.
   * `stacked` : au-dessus d'une modale formulaire (ex. admin catalogue, fiche utilisateur).
   */
  elevation?: "base" | "stacked";
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}

function confirmClass(variant: ConfirmModalVariant): string {
  switch (variant) {
    case "danger":
      return "sn-confirm-modal-btn--danger";
    case "warning":
      return "sn-confirm-modal-btn--warning";
    default:
      return "sn-confirm-modal-btn--default";
  }
}

function iconClass(variant: ConfirmModalVariant): string {
  switch (variant) {
    case "danger":
      return "sn-confirm-modal-icon--danger";
    case "warning":
      return "sn-confirm-modal-icon--warning";
    default:
      return "sn-confirm-modal-icon--default";
  }
}

function ConfirmIcon({ variant }: { variant: ConfirmModalVariant }) {
  if (variant === "danger" || variant === "warning") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Annuler",
  variant = "default",
  onConfirm,
  onCancel,
  closeOnBackdropClick = false,
  elevation = "base",
  confirmDisabled = false,
  cancelDisabled = false,
}: ConfirmModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cancelDisabled) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, cancelDisabled]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const buttons = panelRef.current.querySelectorAll<HTMLButtonElement>(
      ".sn-confirm-modal-actions .sn-confirm-modal-btn",
    );
    const firstEnabled = Array.from(buttons).find((b) => !b.disabled);
    firstEnabled?.focus();
  }, [open, confirmDisabled, cancelDisabled]);

  if (!open) return null;

  const backdropClass =
    elevation === "stacked"
      ? "sn-confirm-modal-backdrop sn-confirm-modal-backdrop--stacked"
      : "sn-confirm-modal-backdrop";

  return createPortal(
    <div
      className={backdropClass}
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="sn-confirm-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sn-confirm-modal-body">
          <div className={`sn-confirm-modal-icon ${iconClass(variant)}`} aria-hidden>
            <ConfirmIcon variant={variant} />
          </div>
          <div className="sn-confirm-modal-text">
            <h2 id={titleId} className="sn-confirm-modal-title">
              {title}
            </h2>
            <p className="sn-confirm-modal-message">{message}</p>
          </div>
        </div>
        <div className="sn-confirm-modal-actions">
          <button
            type="button"
            className="sn-confirm-modal-btn sn-confirm-modal-btn--secondary"
            onClick={onCancel}
            disabled={cancelDisabled}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`sn-confirm-modal-btn ${confirmClass(variant)}`}
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
