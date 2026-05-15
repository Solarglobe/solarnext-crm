/**
 * Mission Engine V1 — Multi-select utilisateurs searchable avec tags
 * LOT C — panneau en portail (PlanningDropdownPanel), z-index CRM, pas de clip overflow modal.
 */

import { useEffect, useRef, useState } from "react";
import PlanningDropdownPanel from "./PlanningDropdownPanel";
import "./user-multi-select.css";

export interface UserOption {
  id: string;
  email?: string;
}

interface UserMultiSelectProps {
  users: UserOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  maxHeight?: string;
  disabled?: boolean;
}

export default function UserMultiSelect({
  users,
  value,
  onChange,
  placeholder = "Rechercher et sélectionner…",
  maxHeight = "200px",
  disabled = false,
}: UserMultiSelectProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = users.filter(
    (u) =>
      !value.includes(u.id) &&
      (search === "" ||
        (u.email || u.id).toLowerCase().includes(search.toLowerCase())),
  );

  const selectedUsers = users.filter((u) => value.includes(u.id));

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

  const add = (id: string) => {
    if (!value.includes(id)) onChange([...value, id]);
    setSearch("");
  };

  const remove = (id: string) => {
    onChange(value.filter((x) => x !== id));
  };

  return (
    <div className="planning-user-multi-select" ref={anchorRef}>
      <div
        className={`planning-user-multi-select-trigger ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}
        onClick={() => !disabled && setOpen(!open)}
      >
        <div className="planning-user-multi-select-sn-row">
          {selectedUsers.map((u) => (
            <span key={u.id} className="planning-user-multi-select-sn-inner sn-badge sn-badge-info">
              {u.email || u.id}
              <button
                type="button"
                className="planning-user-multi-select-sn-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(u.id);
                }}
                aria-label="Retirer"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            className="planning-user-multi-select-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={selectedUsers.length === 0 ? placeholder : ""}
            disabled={disabled}
          />
        </div>
      </div>
      <PlanningDropdownPanel
        ref={panelRef}
        open={open}
        anchorRef={anchorRef}
        onRequestClose={() => setOpen(false)}
      >
        <div
          className="planning-user-multi-select-list planning-dropdown-panel__scroll"
          style={{ maxHeight }}
        >
          {filtered.length === 0 ? (
            <div className="planning-user-multi-select-empty">Aucun résultat</div>
          ) : (
            filtered.slice(0, 200).map((u) => (
              <div
                key={u.id}
                className="planning-user-multi-select-option"
                onClick={() => add(u.id)}
              >
                {u.email || u.id}
              </div>
            ))
          )}
        </div>
      </PlanningDropdownPanel>
    </div>
  );
}
