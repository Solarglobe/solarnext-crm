/**
 * CP-078B — Bandeau SUPER_ADMIN : mode support (autre tenant) + édition explicite.
 */

import React, { useCallback, useState } from "react";
import { useOrganization } from "../../contexts/OrganizationContext";

export function SuperAdminSupportBanner() {
  const {
    isSuperAdmin,
    currentOrganization,
    superAdminEditMode,
    setSuperAdminEditMode,
    isSupportTenantContext,
    exitSupportMode,
  } = useOrganization();

  const [quitting, setQuitting] = useState(false);

  const orgLabel = currentOrganization?.name?.trim() || "Organisation";

  const toggleEdit = useCallback(() => {
    if (!superAdminEditMode) {
      const ok = window.confirm(
        "Activer le mode édition SUPER ADMIN ? Les écritures seront autorisées et tracées côté serveur."
      );
      if (!ok) return;
    }
    setSuperAdminEditMode(!superAdminEditMode);
  }, [superAdminEditMode, setSuperAdminEditMode]);

  const onQuit = useCallback(async () => {
    if (quitting) return;
    setQuitting(true);
    try {
      await exitSupportMode();
    } catch {
      /* alert déjà affiché */
    } finally {
      setQuitting(false);
    }
  }, [exitSupportMode, quitting]);

  if (!isSuperAdmin) return null;

  const title = superAdminEditMode ? (
    <>⚠ Mode édition SUPER ADMIN activé</>
  ) : isSupportTenantContext ? (
    <>
      <span aria-hidden>🔵</span> Mode support — {orgLabel}
    </>
  ) : (
    <>Super admin — {orgLabel}</>
  );

  return (
    <div
      role="status"
      className={`sn-super-admin-banner${superAdminEditMode ? " sn-super-admin-banner--edit" : ""}`}
      style={{
        flexShrink: 0,
        width: "100%",
        padding: "8px 16px",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        borderBottom: "1px solid var(--border)",
        background: superAdminEditMode
          ? "color-mix(in srgb, var(--danger, #EF4444) 14%, var(--bg-muted))"
          : "color-mix(in srgb, var(--primary, #6366F1) 12%, var(--bg-muted))",
        color: "var(--text)",
      }}
    >
      <span style={{ fontWeight: 600 }}>{title}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {isSupportTenantContext && (
          <button
            type="button"
            className="sn-btn sn-btn-sm"
            style={{ whiteSpace: "nowrap" }}
            disabled={quitting}
            onClick={onQuit}
          >
            {quitting ? "…" : "Quitter"}
          </button>
        )}
        <button
          type="button"
          className="sn-btn sn-btn-sm"
          style={{ whiteSpace: "nowrap" }}
          onClick={toggleEdit}
        >
          {superAdminEditMode ? "Repasser en lecture seule" : "Activer l’édition"}
        </button>
      </div>
    </div>
  );
}
