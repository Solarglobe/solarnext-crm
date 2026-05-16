/**
 * ConfirmDialog — Pattern unique de confirmation destructive.
 * Réutilisable pour : Reset calpinage, Suppression bloc, Retour Phase 3 → Phase 2.
 * Design aligné SolarGlobe.
 */
import { useEffect, useRef } from "react";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  /** Titre affiché dans le <h2> de la dialog. Optionnel — fallback "⚠️ Action importante". */
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = "⚠️ Action importante",
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // ── Hooks — tous AVANT tout return conditionnel (Rules of Hooks) ───────────

  /** Verrou anti double-submit : empêche deux appels onConfirm si clics rapides. */
  const submittedRef = useRef(false);

  /** Référence sur le bouton de confirmation pour le focus trap. */
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  /** Reset du verrou à chaque ouverture. */
  useEffect(() => {
    if (open) submittedRef.current = false;
  }, [open]);

  /** Fermeture par Escape. */
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onCancel]);

  /** Focus trap : focus le bouton de confirmation à l'ouverture. */
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => confirmBtnRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // ── Guard conditionnel (après tous les hooks) ─────────────────────────────
  if (!open) return null;

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
          {title}
        </h2>
        <p id="confirm-dialog-description" className={styles.description}>
          {description}
        </p>
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
            ref={confirmBtnRef}
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
