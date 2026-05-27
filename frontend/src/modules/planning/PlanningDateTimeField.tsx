/**
 * Champ date/heure mission — input natif (datetime-local).
 * Snap automatique au quart d'heure le plus proche au blur.
 * Format interne : YYYY-MM-DDTHH:mm (identique à la valeur ISO slice).
 */

import { snapToQuarter } from "./planningDateTime.utils";

export interface PlanningDateTimeFieldProps {
  label: string;
  /** Chaîne locale `YYYY-MM-DDTHH:mm` (slice ISO) */
  value: string;
  onChange: (nextLocalSlice: string) => void;
  disabled?: boolean;
}

export default function PlanningDateTimeField({
  label,
  value,
  onChange,
  disabled = false,
}: PlanningDateTimeFieldProps) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value; // YYYY-MM-DDTHH:mm
    if (!raw) return;
    const snapped = snapToQuarter(new Date(raw));
    onChange(snapped.toISOString().slice(0, 16));
  }

  /** Snap supplémentaire au blur pour capturer la saisie clavier libre */
  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (!raw) return;
    const snapped = snapToQuarter(new Date(raw));
    const snappedSlice = snapped.toISOString().slice(0, 16);
    if (snappedSlice !== value) onChange(snappedSlice);
  }

  return (
    <div className="planning-modal-field">
      <label className="sn-form-label">{label}</label>
      <input
        type="datetime-local"
        className="planning-datetime-input"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        step={900}
        disabled={disabled}
      />
    </div>
  );
}
