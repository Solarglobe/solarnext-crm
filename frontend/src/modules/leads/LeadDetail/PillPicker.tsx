
interface PillOption {
  value: string;
  label: string;
}

interface PillPickerProps {
  options: PillOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  /** Si false, re-cliquer sur la pill active ne désélectionne pas (utile pour les champs obligatoires). Default: true */
  allowDeselect?: boolean;
}

/**
 * PillPicker — remplace un <select> natif par des pills cliquables.
 * - L'option vide ("") est ignorée
 * - Re-clic sur la pill active → désélectionne (sauf si allowDeselect=false)
 */
export default function PillPicker({
  options,
  value,
  onChange,
  disabled,
  allowDeselect = true,
}: PillPickerProps) {
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
              if (isActive && allowDeselect) {
                onChange(undefined);
              } else if (!isActive) {
                onChange(o.value);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
