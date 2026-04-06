/**
 * Dropdown searchable (pas select HTML natif)
 * LOT C — panneau en portail (PlanningDropdownPanel), z-index CRM, pas de clip overflow modal.
 */

import React, { useEffect, useRef, useState } from "react";
import PlanningDropdownPanel from "./PlanningDropdownPanel";
import "./searchable-dropdown.css";

export interface DropdownOption {
  id: string;
  label: string;
  color?: string;
}

interface SearchableDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}

export default function SearchableDropdown({
  options,
  value,
  onChange,
  placeholder = "Sélectionner…",
  emptyLabel = "—",
  disabled = false,
}: SearchableDropdownProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered =
    search === ""
      ? options
      : options.filter((o) =>
          o.label.toLowerCase().includes(search.toLowerCase()),
        );

  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <div className="planning-searchable-dropdown" ref={anchorRef}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={`planning-searchable-dropdown-trigger ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected ? (
          <span className="planning-searchable-dropdown-value">
            {selected.color && (
              <span
                className="planning-searchable-dropdown-color-dot"
                style={{ backgroundColor: selected.color }}
              />
            )}
            {selected.label}
          </span>
        ) : (
          <span className="planning-searchable-dropdown-placeholder">{placeholder}</span>
        )}
      </div>
      <PlanningDropdownPanel
        ref={panelRef}
        open={open}
        anchorRef={anchorRef}
        onRequestClose={() => setOpen(false)}
      >
        <input
          type="text"
          className="planning-searchable-dropdown-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          autoFocus
        />
        <div
          className="planning-searchable-dropdown-list planning-dropdown-panel__scroll"
          role="listbox"
        >
          <div
            role="option"
            className="planning-searchable-dropdown-option"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {emptyLabel}
          </div>
          {filtered.map((o) => (
            <div
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`planning-searchable-dropdown-option ${o.id === value ? "selected" : ""}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {o.color && (
                <span
                  className="planning-searchable-dropdown-color-dot"
                  style={{ backgroundColor: o.color }}
                />
              )}
              {o.label}
            </div>
          ))}
        </div>
      </PlanningDropdownPanel>
    </div>
  );
}
