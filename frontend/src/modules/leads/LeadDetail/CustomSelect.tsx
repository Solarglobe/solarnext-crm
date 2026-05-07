import React, { useEffect, useRef, useState } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  id?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * CustomSelect — remplace un <select> natif par un bouton + menu positionné.
 * Même API de données que <select>, zéro UI navigateur.
 */
export default function CustomSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "—",
  disabled,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Ferme le menu si click à l'extérieur
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Ferme avec Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const activeOption = options.find((o) => o.value === value);
  const displayLabel = activeOption?.label ?? placeholder;
  const isPlaceholder = !activeOption || !activeOption.value;

  return (
    <div
      ref={rootRef}
      className={`crm-custom-select${open ? " crm-custom-select--open" : ""}`}
    >
      <button
        id={id}
        type="button"
        disabled={disabled}
        className="crm-custom-select__trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`crm-custom-select__value${isPlaceholder ? " crm-custom-select__value--placeholder" : ""}`}>
          {displayLabel}
        </span>
        <span className="crm-custom-select__chevron" aria-hidden />
      </button>

      {open && (
        <div className="crm-custom-select__menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value || "_placeholder"}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`crm-custom-select__option${o.value === value ? " crm-custom-select__option--active" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
