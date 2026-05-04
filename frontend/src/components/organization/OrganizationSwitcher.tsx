import React, { useEffect, useId, useRef, useState } from "react";
import { useOrganization } from "../../contexts/OrganizationContext";

/**
 * CP-078 — Sélecteur d’organisation (SUPER_ADMIN, &gt;1 org) ou libellé seul.
 */
export function OrganizationSwitcher() {
  const {
    organizations,
    currentOrganization,
    switchOrganization,
    isSuperAdmin,
  } = useOrganization();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  if (!currentOrganization) return null;

  if (!isSuperAdmin || organizations.length <= 1) {
    return (
      <div
        className="sn-badge sn-badge-neutral"
        title="Organisation active"
        style={{
          maxWidth: 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {currentOrganization.name}
      </div>
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="sn-btn sn-btn-ghost"
        style={{
          fontSize: 12,
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        {currentOrganization.name}
        <span style={{ marginLeft: 6, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="sn-card"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            minWidth: 220,
            maxHeight: 280,
            overflowY: "auto",
            zIndex: 200,
            padding: 4,
            listStyle: "none",
            margin: 0,
          }}
        >
          {organizations.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={o.id === currentOrganization.id}
                onClick={() => {
                  setOpen(false);
                  if (o.id !== currentOrganization.id) switchOrganization(o.id);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  border: "none",
                  background:
                    o.id === currentOrganization.id ? "var(--surface-elevated)" : "transparent",
                  cursor: "pointer",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
