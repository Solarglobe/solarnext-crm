/**
 * ToastProvider — Système de toast centralisé pour le module Calpinage.
 * Expose window.calpinageToast et window.showToast pour le legacy.
 *
 * MOBILE UX (ajouts) :
 *   - Bouton × (toastClose) visible sur mobile via @media (max-width: 768px)
 *   - Swipe-to-dismiss gauche (deltaX < 0, seuil 80 px) via Pointer Events API
 *   - Reset fluide : transition transform 150ms ease si swipe < 80 px
 */
import {
  createContext,
  useCallback,
  useContext,
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

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast doit être utilisé à l'intérieur de ToastProvider");
  return ctx;
}

let nextId = 0;

// ─── Sous-composant : un toast swipeable ─────────────────────────────────────

interface SwipeableToastProps {
  item: ToastItem;
  typeClass: string;
  onDismiss: (id: number) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function SwipeableToast({
  item,
  typeClass,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: SwipeableToastProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const startXRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    startXRef.current = e.clientX;
    isDraggingRef.current = true;
    setIsResetting(false);
    // Capture le pointeur pour recevoir les events même hors de l'élément
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || startXRef.current === null) return;
    const deltaX = e.clientX - startXRef.current;
    // Swipe gauche seulement (deltaX < 0)
    if (deltaX < 0) {
      setTranslateX(deltaX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || startXRef.current === null) return;
    isDraggingRef.current = false;
    const deltaX = e.clientX - startXRef.current;
    startXRef.current = null;

    if (Math.abs(deltaX) > 80) {
      // Seuil dépassé → dismiss
      onDismiss(item.id);
    } else {
      // Seuil non atteint → reset fluide
      setIsResetting(true);
      setTranslateX(0);
    }
  };

  const handlePointerCancel = () => {
    isDraggingRef.current = false;
    startXRef.current = null;
    setIsResetting(true);
    setTranslateX(0);
  };

  return (
    <div
      className={`${styles.toast} ${typeClass}`}
      role="alert"
      style={{
        transform: translateX !== 0 ? `translateX(${translateX}px)` : undefined,
        transition: isResetting ? "transform 150ms ease" : "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className={styles.toastMessage}>{item.message}</span>
      <button
        type="button"
        className={styles.toastClose}
        aria-label="Fermer"
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </div>
  );
}

// ─── Provider principal ───────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: number) => {
      const timer = setTimeout(() => {
        timersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timer);
    },
    [],
  );

  const addToast = useCallback(
    (message: string, type: ToastType) => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, message, type }]);
      scheduleAutoDismiss(id);
    },
    [scheduleAutoDismiss],
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
  }, [addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTypeClass = (type: ToastType): string => {
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
          <SwipeableToast
            key={t.id}
            item={t}
            typeClass={getTypeClass(t.type)}
            onDismiss={dismissToast}
            onMouseEnter={() => {
              // Pause l'auto-dismiss au survol souris (desktop)
              const timer = timersRef.current.get(t.id);
              if (timer) {
                clearTimeout(timer);
                timersRef.current.delete(t.id);
              }
            }}
            onMouseLeave={() => {
              // Reprend l'auto-dismiss après survol
              scheduleAutoDismiss(t.id);
            }}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
