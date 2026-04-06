/**
 * ConfirmDialog — Pattern unique de confirmation destructive.
 * Réutilisable pour : Reset calpinage, Suppression bloc, Retour Phase 3 → Phase 2.
 * Design aligné SolarGlobe.
 */
import { useEffect, useRef } from "react";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onCancel]);

  if (!open) return null;

  const submittedRef = useRef(false);
  useEffect(() => {
    if (open) submittedRef.current = false;
  }, [open]);

  const handleConfirm = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onConfirm();
    onCancel();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onClick={handleOverlayClick}
    >
      <div className={styles.card}>
        <h2 id="confirm-dialog-title" className={styles.title}>
          ⚠️ Action importante
        </h2>
        <p id="confirm-dialog-description" className={styles.subtitle}>
          {title}
        </p>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnCancel}
            onClick={onCancel}
            aria-label={cancelLabel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={styles.btnConfirm}
            onClick={handleConfirm}
            aria-label={confirmLabel}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
