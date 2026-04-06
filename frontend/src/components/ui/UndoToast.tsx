import React from "react";
import { createPortal } from "react-dom";
import "./undo-toast.css";

export interface UndoToastProps {
  message: string;
  undoLabel?: string;
  secondsLeft: number;
  onUndo: () => void;
  /** Pause countdown while hovered (bonus UX) */
  pauseOnHover?: boolean;
  onPauseChange?: (paused: boolean) => void;
}

export function UndoToast({
  message,
  undoLabel = "Annuler",
  secondsLeft,
  onUndo,
  pauseOnHover = true,
  onPauseChange,
}: UndoToastProps) {
  return createPortal(
    <div
      className="sn-undo-toast-host"
      role="status"
      aria-live="polite"
      onMouseEnter={() => pauseOnHover && onPauseChange?.(true)}
      onMouseLeave={() => pauseOnHover && onPauseChange?.(false)}
    >
      <div className="sn-undo-toast">
        <span className="sn-undo-toast-msg">{message}</span>
        <div className="sn-undo-toast-actions">
          <span className="sn-undo-toast-timer" aria-hidden>
            ({secondsLeft}s)
          </span>
          <button type="button" className="sn-undo-toast-btn" onClick={onUndo}>
            {undoLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
