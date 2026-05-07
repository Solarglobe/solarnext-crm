import React from "react";

interface PillOption {
  value: string;
  label: string;
}

interface PillPickerProps {
  options: PillOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

/**
 * PillPicker — remplace un <select> natif par des pills cliquables.
 * - Clic sur la pill active → désélectionne (valeur undefined)
 * - L'option vide ("") est ignorée (la désélection se fait par re-clic)
 */
export default function PillPicker({ options, value, onChange, disabled }: PillPickerProps) {
  const filtered = options.filter((o) => o.value !== "");

  return (
    <div className="crm-pill-picker">
      {filtered.map((o) => {
        const isActive = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            className={`crm-pill-picker__option${isActive ? " crm-pill-picker__option--active" : ""}`}
            onClick={() => {
              if (disabled) return;
              onChange(isActive ? undefined : o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
