import { useCallback, useRef, useState } from "react";

export type UndoAction<TPrevious = unknown> = {
  id: string;
  previousState: TPrevious;
  execute: () => Promise<void>;
  rollback: () => Promise<void>;
};

export interface ScheduleUndoOptions<TPrevious = unknown> {
  previousState: TPrevious;
  execute: () => Promise<void>;
  rollback: () => Promise<void>;
  message?: string;
  durationMs?: number;
}

export interface ActiveUndoToast {
  message: string;
  secondsLeft: number;
  onUndo: () => void;
  onHoverPause: (paused: boolean) => void;
}

export interface UseUndoActionResult {
  scheduleUndo: <T>(opts: ScheduleUndoOptions<T>) => Promise<void>;
  activeToast: ActiveUndoToast | null;
}

const DEFAULT_DURATION_MS = 5000;

/**
 * Undo rapide : après execute(), affiche un toast avec rollback pendant ~5s.
 * Pause au survol : le délai est prolongé du temps passé en hover.
 */
export function useUndoAction(): UseUndoActionResult {
  const [activeToast, setActiveToast] = useState<ActiveUndoToast | null>(null);

  const rollbackRef = useRef<(() => Promise<void>) | null>(null);
  const endTimeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  const pauseStartedAtRef = useRef<number | null>(null);

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTick();
    rollbackRef.current = null;
    pausedRef.current = false;
    pauseStartedAtRef.current = null;
    setActiveToast(null);
  }, [clearTick]);

  const scheduleUndo = useCallback(
    async <T,>(opts: ScheduleUndoOptions<T>) => {
      await opts.execute();

      clearTick();
      rollbackRef.current = opts.rollback;

      const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
      const message = opts.message ?? "Statut mis à jour";
      endTimeRef.current = Date.now() + durationMs;

      const tick = () => {
        if (pausedRef.current) return;
        const left = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
        setActiveToast((prev) =>
          prev
            ? {
                ...prev,
                secondsLeft: left,
              }
            : null
        );
        if (left <= 0) {
          dismiss();
        }
      };

      const onHoverPause = (paused: boolean) => {
        if (paused) {
          pausedRef.current = true;
          pauseStartedAtRef.current = Date.now();
        } else {
          if (pauseStartedAtRef.current != null) {
            endTimeRef.current += Date.now() - pauseStartedAtRef.current;
          }
          pauseStartedAtRef.current = null;
          pausedRef.current = false;
        }
      };

      setActiveToast({
        message,
        secondsLeft: Math.ceil(durationMs / 1000),
        onUndo: () => {
          const rb = rollbackRef.current;
          dismiss();
          if (rb) void rb();
        },
        onHoverPause,
      });

      intervalRef.current = setInterval(tick, 200);
    },
    [clearTick, dismiss]
  );

  return { scheduleUndo, activeToast };
}
