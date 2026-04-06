/**
 * ToastProvider — Système de toast centralisé pour le module Calpinage.
 * Expose window.calpinageToast et window.showToast pour le legacy.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./Toast.module.css";

const AUTO_DISMISS_MS = 4000;

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType) => {
      const id = ++nextId;
      const item: ToastItem = { id, message, type };

      setToasts((prev) => [...prev, item]);

      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    []
  );

  const toastApi: ToastApi = {
    success: (m) => addToast(m, "success"),
    error: (m) => addToast(m, "error"),
    warning: (m) => addToast(m, "warning"),
    info: (m) => addToast(m, "info"),
  };

  useEffect(() => {
    (window as any).calpinageToast = toastApi;
    (window as any).showToast = (message: string, success: boolean) => {
      addToast(message, success ? "success" : "error");
    };
    return () => {
      delete (window as any).calpinageToast;
      delete (window as any).showToast;
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, [addToast]);

  const getTypeClass = (type: ToastType) => {
    switch (type) {
      case "success":
        return styles.toastSuccess;
      case "error":
        return styles.toastError;
      case "warning":
        return styles.toastWarning;
      case "info":
        return styles.toastInfo;
      default:
        return styles.toastSuccess;
    }
  };

  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      <div className={styles.container} role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${getTypeClass(t.type)}`}
            role="alert"
            onMouseEnter={() => {
              const timer = timersRef.current.get(t.id);
              if (timer) {
                clearTimeout(timer);
                timersRef.current.delete(t.id);
              }
            }}
            onMouseLeave={() => {
              const timer = setTimeout(() => {
                timersRef.current.delete(t.id);
                setToasts((prev) => prev.filter((x) => x.id !== t.id));
              }, AUTO_DISMISS_MS);
              timersRef.current.set(t.id, timer);
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
