/**
 * Overlay centré type outil métier (backdrop + panneau scrollable).
 */

import React, { useEffect } from "react";
import { VisiteTechniqueV2 } from "./VisiteTechniqueV2";
import styles from "./VisiteTechniqueModal.module.css";

export interface VisiteTechniqueModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
}

export function VisiteTechniqueModal({
  open,
  onClose,
  clientId,
}: VisiteTechniqueModalProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!clientId) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      hidden={!open}
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        className={styles.shell}
        role="dialog"
        aria-modal="true"
        aria-label="Visite technique"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Visite technique</h2>
          <button
            type="button"
            className={`sn-btn sn-btn-ghost sn-btn-sm ${styles.closeBtn}`}
            onClick={onClose}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          <VisiteTechniqueV2 clientId={clientId} showPageTitle={false} />
        </div>
      </div>
    </div>
  );
}
