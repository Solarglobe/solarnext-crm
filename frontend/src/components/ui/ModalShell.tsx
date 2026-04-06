import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import "./modal-shell.css";

export type ModalShellSize = "sm" | "md" | "lg" | "xl";

export interface ModalShellProps {
  open: boolean;
  /** Fermeture « Annuler » / backdrop / Escape (selon props). */
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: ModalShellSize;
  /** Contenu scrollable (formulaire ou fragment). */
  children: React.ReactNode;
  /** Pied de modale (boutons) — hors scroll, souvent avec `form` sur le submit. */
  footer?: React.ReactNode;
  /** Défaut : true pour les modales admin (comportement habituel). */
  closeOnBackdropClick?: boolean;
  /**
   * Si défini, appelé sur Escape à la place de `onClose` (ex. catalogue : gérer quit confirm).
   */
  onEscape?: () => void;
  /** Afficher le bouton × dans le header. Défaut : true. */
  showCloseButton?: boolean;
  /** Classes sur le panneau (ex. layout métier existant). */
  panelClassName?: string;
  /** Classes sur la zone body scrollable. */
  bodyClassName?: string;
}

export function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  children,
  footer,
  closeOnBackdropClick = true,
  onEscape,
  showCloseButton = true,
  panelClassName = "",
  bodyClassName = "",
}: ModalShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (onEscape) onEscape();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onEscape]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const root = panelRef.current;
    const focusable = root.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [open]);

  if (!open) return null;

  const sizeClass = `sn-modal-shell-panel--${size}`;

  return createPortal(
    <div
      className="sn-modal-shell-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`sn-card sn-card-premium sn-modal-shell-panel ${sizeClass} ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sn-modal-shell-header">
          <div className="sn-modal-shell-header-text">
            <h2 id={titleId} className="sn-modal-shell-title">
              {title}
            </h2>
            {subtitle != null && subtitle !== "" ? (
              <p className="sn-modal-shell-subtitle">{subtitle}</p>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              className="sn-modal-shell-close"
              onClick={onClose}
              aria-label="Fermer"
            >
              ×
            </button>
          ) : null}
        </div>
        <div className={`sn-modal-shell-body ${bodyClassName}`.trim()}>{children}</div>
        {footer != null ? <div className="sn-modal-shell-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
