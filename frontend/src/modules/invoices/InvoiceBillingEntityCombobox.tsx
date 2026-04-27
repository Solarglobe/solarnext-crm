/**
 * Sélection client / lead facturation — recherche locale sur données déjà chargées.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BillingSelectRow } from "@/services/billingContacts.api";

const MAX_RESULTS = 20;

function rowHaystack(r: BillingSelectRow): string {
  const parts = [r.full_name, r.company_name, r.first_name, r.last_name, r.email].filter(
    (x) => x != null && String(x).trim() !== ""
  );
  return parts.join(" ").toLowerCase();
}

export type InvoiceBillingEntityComboboxProps = {
  label: string;
  disabled: boolean;
  value: string | null;
  rows: BillingSelectRow[];
  onChange: (id: string | null) => void;
  /** Affichage si l’id courant n’est pas dans `rows` (ex. fiche archivée / hors périmètre). */
  fallbackId?: string | null;
  fallbackLabel?: string | null;
};

export function InvoiceBillingEntityCombobox({
  label,
  disabled,
  value,
  rows,
  onChange,
  fallbackId,
  fallbackLabel,
}: InvoiceBillingEntityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedRow = useMemo(() => rows.find((r) => r.id === value) ?? null, [rows, value]);

  const displayLabel = useMemo(() => {
    if (!value) return "";
    if (selectedRow) return selectedRow.full_name || value;
    if (fallbackId && value === fallbackId && fallbackLabel) return fallbackLabel;
    return value;
  }, [value, selectedRow, fallbackId, fallbackLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows.slice(0, MAX_RESULTS);
    return rows.filter((r) => rowHaystack(r).includes(q)).slice(0, MAX_RESULTS);
  }, [rows, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = useCallback(
    (id: string | null) => {
      onChange(id);
      setQuery("");
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div ref={rootRef} className="ib-billing-combo" style={{ position: "relative", minWidth: 200 }}>
      <span className="ib-billing-combo-label">{label}</span>
      <div className="ib-billing-combo-field-row">
        <input
          type="text"
          className="sn-input ib-billing-combo-input"
          disabled={disabled}
          placeholder={value ? "Tapez pour filtrer…" : "Rechercher…"}
          value={open ? query : value ? displayLabel : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setQuery("");
            }
          }}
          aria-autocomplete="list"
          aria-expanded={open}
          autoComplete="off"
        />
        {!disabled && value ? (
          <button type="button" className="ib-billing-combo-clear" onClick={() => pick(null)}>
            Effacer
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <ul className="ib-billing-combo-menu" role="listbox">
          {filtered.length === 0 ? (
            <li className="ib-billing-combo-empty">Aucun résultat</li>
          ) : (
            filtered.map((r) => (
              <li key={r.id}>
                <button type="button" className="ib-billing-combo-option" onClick={() => pick(r.id)}>
                  {r.full_name || r.id}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
