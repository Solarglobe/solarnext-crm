/**
 * ConfirmProvider — Expose window.requestCalpinageConfirm pour le legacy.
 * Permet d'afficher une confirmation destructive avant d'exécuter une action.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { getCalpinageWindow } from "../calpinageWindowGlobals";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const optionsRef = useRef<ConfirmOptions | null>(null);

  const requestConfirm = useCallback((options: ConfirmOptions) => {
    optionsRef.current = options;
    setOpen(true);
  }, []);

  const handleConfirm = useCallback(() => {
    const opts = optionsRef.current;
    optionsRef.current = null;
    setOpen(false);
    opts?.onConfirm();
  }, []);

  const handleCancel = useCallback(() => {
    optionsRef.current = null;
    setOpen(false);
  }, []);

  useEffect(() => {
    const w = getCalpinageWindow();
    w.requestCalpinageConfirm = requestConfirm;
    return () => {
      delete w.requestCalpinageConfirm;
    };
  }, [requestConfirm]);

  const opts = optionsRef.current;

  return (
    <>
      {children}
      {open && opts && (
        <ConfirmDialog
          open={open}
          title={opts.title}
          description={opts.description}
          confirmLabel={opts.confirmLabel}
          cancelLabel={opts.cancelLabel}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}
