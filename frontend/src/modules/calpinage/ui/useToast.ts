/**
 * useToast — Hook pour afficher des toasts (React components).
 * Le legacy utilise window.calpinageToast exposé par ToastProvider.
 */
import { useContext } from "react";
import { ToastContext } from "./ToastProvider";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      success: (m) => console.info("[Toast]", m),
      error: (m) => console.error("[Toast]", m),
      warning: (m) => console.warn("[Toast]", m),
      info: (m) => console.info("[Toast]", m),
    };
  }
  return ctx;
}
