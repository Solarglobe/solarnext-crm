import { useState } from "react";

const SPACE_CHARS = /[\s\u202f\u00a0]/g;

export function parseFrNumericInput(raw: string, integer: boolean): number | null {
  const t = raw.trim().replace(SPACE_CHARS, "").replace(",", ".");
  if (t === "" || t === "-" || t === "+") return null;
  if (integer) {
    if (!/^-?\d+$/.test(t)) return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (!/^-?\d*\.?\d*$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min?: number, max?: number): number {
  let x = n;
  if (min != null) x = Math.max(min, x);
  if (max != null) x = Math.min(max, x);
  return x;
}

function formatFrGrouped(n: number, integer: boolean, minFrac: number, maxFrac: number): string {
  return new Intl.NumberFormat("fr-FR", {
    useGrouping: true,
    minimumFractionDigits: integer ? 0 : minFrac,
    maximumFractionDigits: integer ? 0 : maxFrac,
  }).format(integer ? Math.trunc(n) : n);
}

function formatFrPlain(n: number, integer: boolean, maxFrac: number): string {
  if (integer) return String(Math.trunc(n));
  return new Intl.NumberFormat("fr-FR", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  }).format(n);
}

export type LocaleNumberInputProps = {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  className?: string;
  min?: number;
  max?: number;
  /** Saisie et affichage entiers (pas de décimales). */
  integer?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** Si défini, champ vide au commit (blur / effacement) = cette valeur (puis clamp min/max). */
  emptyCommitValue?: number;
  /** Affiche un champ vide tant que la valeur est 0 (hors focus), ex. montant optionnel. */
  displayEmptyWhenZero?: boolean;
  placeholder?: string;
  title?: string;
  "aria-label"?: string;
  id?: string;
};

/**
 * Champ texte avec séparateurs de milliers fr-FR au repos, saisie virgule/point acceptée.
 */
export default function LocaleNumberInput({
  value,
  onChange,
  disabled,
  className,
  min,
  max,
  integer = false,
  minimumFractionDigits = 0,
  maximumFractionDigits,
  emptyCommitValue,
  displayEmptyWhenZero = false,
  placeholder,
  title,
  "aria-label": ariaLabel,
  id,
}: LocaleNumberInputProps) {
  const maxFrac = maximumFractionDigits ?? (integer ? 0 : 2);
  const minFrac = integer ? 0 : minimumFractionDigits;

  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const showGrouped = !focused;
  const safeVal = Number.isFinite(value) ? value : 0;
  const showBlankZero = Boolean(displayEmptyWhenZero) && showGrouped && safeVal === 0;
  const display = showBlankZero ? "" : showGrouped ? formatFrGrouped(safeVal, integer, minFrac, maxFrac) : draft;

  const emptyBase = emptyCommitValue ?? 0;

  const commit = (raw: string, fallback: number) => {
    const trimmed = raw.trim();
    const p = parseFrNumericInput(raw, integer);
    let next: number;
    if (p !== null) next = clamp(integer ? Math.trunc(p) : p, min, max);
    else if (trimmed === "") next = clamp(emptyBase, min, max);
    else next = fallback;
    if (next !== value) onChange(next);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      autoComplete="off"
      className={[className, "qb-locale-num"].filter(Boolean).join(" ")}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={display}
      onFocus={() => {
        setFocused(true);
        const sv = Number.isFinite(value) ? value : 0;
        if (displayEmptyWhenZero && sv === 0) setDraft("");
        else setDraft(formatFrPlain(sv, integer, maxFrac));
      }}
      onBlur={() => {
        commit(draft, value);
        setFocused(false);
        setDraft("");
      }}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (v.trim() === "") {
          onChange(clamp(emptyBase, min, max));
          return;
        }
        const p = parseFrNumericInput(v, integer);
        if (p !== null) onChange(clamp(integer ? Math.trunc(p) : p, min, max));
      }}
    />
  );
}
