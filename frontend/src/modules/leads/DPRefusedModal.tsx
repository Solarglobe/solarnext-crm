import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { DPRefusedChoice } from "./dpRefusedStatus";
import "../../components/ui/confirm-modal.css";

export interface DPRefusedModalProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onChoose: (choice: DPRefusedChoice) => void | Promise<void>;
}

export function DPRefusedModal({
  open,
  busy = false,
  onClose,
  onChoose,
}: DPRefusedModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="sn-confirm-modal-backdrop sn-confirm-modal-backdrop--stacked" role="presentation">
      <div
        className="sn-confirm-modal-panel"
        style={{ width: "min(480px, 100%)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sn-dp-refused-title"
      >
        <h2 id="sn-dp-refused-title" className="sn-confirm-modal-title">
          Déclaration préalable refusée
        </h2>
        <p className="sn-confirm-modal-message">
          Que souhaitez-vous faire pour ce projet ?
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            padding: "0 1.25rem 1rem",
          }}
        >
          <button
            type="button"
            disabled={busy}
            className="sn-confirm-modal-btn sn-confirm-modal-btn--default"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => void onChoose("corriger")}
          >
            Corriger et relancer — réflexion / suivi
          </button>
          <button
            type="button"
            disabled={busy}
            className="sn-confirm-modal-btn sn-confirm-modal-btn--warning"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => void onChoose("attente")}
          >
            Mettre en attente — suivi (reprise ultérieure)
          </button>
          <button
            type="button"
            disabled={busy}
            className="sn-confirm-modal-btn sn-confirm-modal-btn--danger"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => void onChoose("perdu")}
          >
            Classer en perdu
          </button>
        </div>

        <div className="sn-confirm-modal-actions" style={{ paddingTop: 0 }}>
          <button
            type="button"
            className="sn-confirm-modal-btn sn-confirm-modal-btn--ghost"
            disabled={busy}
            onClick={onClose}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
