import React, { useCallback, useEffect, useState } from "react";

const MONTH_LABELS = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
];

function monthsMapToDraftStrings(monthsMap: Record<number, number>): Record<number, string> {
  const o: Record<number, string> = {};
  for (let m = 1; m <= 12; m++) {
    const v = monthsMap[m];
    o[m] = v != null && v !== 0 ? String(v) : "";
  }
  return o;
}

export interface MonthlyConsumptionGridProps {
  monthsMap: Record<number, number>;
  onMonthsChange: (months: { month: number; kwh: number }[]) => void;
  onGridEditingChange?: (editing: boolean) => void;
  /** Vue overview : flush autosave à la sortie de la grille ; modal : laisser vide. */
  onGridSectionLeave?: () => void;
}

export default function MonthlyConsumptionGrid({
  monthsMap,
  onMonthsChange,
  onGridEditingChange,
  onGridSectionLeave,
}: MonthlyConsumptionGridProps) {
  const [gridFocused, setGridFocused] = useState(false);
  const [local, setLocal] = useState<Record<number, string>>(() => monthsMapToDraftStrings(monthsMap));

  useEffect(() => {
    if (gridFocused) return;
    setLocal(monthsMapToDraftStrings(monthsMap));
  }, [monthsMap, gridFocused]);

  const pushMonthsFromLocal = useCallback(
    (nextLocal: Record<number, string>) => {
      const months = Array.from({ length: 12 }, (_, j) => {
        const m = j + 1;
        const raw = (nextLocal[m] ?? "").trim();
        const kwh =
          raw === "" ? 0 : Number.isFinite(parseInt(raw, 10)) ? parseInt(raw, 10) : 0;
        return { month: m, kwh };
      });
      onMonthsChange(months);
    },
    [onMonthsChange]
  );

  const handleGridFocusCapture = () => {
    setGridFocused(true);
    onGridEditingChange?.(true);
  };

  const handleGridBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setGridFocused(false);
    onGridEditingChange?.(false);
    onGridSectionLeave?.();
  };

  return (
    <div
      className="crm-lead-monthly-grid-wrap"
      onFocusCapture={handleGridFocusCapture}
      onBlur={handleGridBlur}
    >
      <div className="crm-lead-monthly-grid">
        {MONTH_LABELS.map((label, i) => {
          const month = i + 1;
          return (
            <div key={i} className="crm-lead-field">
              <label>{label}</label>
              <input
                className="sn-input crm-lead-monthly-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="0"
                value={local[month] ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw !== "" && !/^\d+$/.test(raw)) return;
                  setLocal((prev) => {
                    const merged = { ...prev, [month]: raw };
                    return merged;
                  });
                }}
                onBlur={() => {
                  setLocal((prev) => {
                    const trimmed = (prev[month] ?? "").trim();
                    const normalized = trimmed === "" ? "" : String(parseInt(trimmed, 10) || 0);
                    const nextLocal = { ...prev, [month]: normalized };
                    pushMonthsFromLocal(nextLocal);
                    return nextLocal;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
