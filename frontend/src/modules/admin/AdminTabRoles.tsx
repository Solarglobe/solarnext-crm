/**
 * CP-ADMIN-UI-03 — Tab Rôles & Permissions
 * Liste rôles + modal permissions groupées par domaine métier
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import {
  adminGetRoles,
  adminGetRolePermissions,
  adminPutRolePermissions,
  adminGetAllPermissions,
  type AdminRole,
  type AdminPermission,
} from "../../services/admin.api";
import {
  DOMAIN_ORDER,
  DOMAIN_TITLES,
  getPermissionUi,
  groupPermissionsByDomain,
  type PermissionDomainKey,
} from "./rbacPermissionLabels";
import "./admin-tab-roles.css";

function AdminRolesSkeleton() {
  return (
    <div className="admin-roles-skeleton" aria-hidden>
      <div className="admin-roles-skeleton-line admin-roles-skeleton-line--medium" />
      <div className="admin-roles-skeleton-line admin-roles-skeleton-line--short" />
      <div className="admin-roles-skeleton-line admin-roles-skeleton-line--medium" />
      <div className="admin-roles-skeleton-line admin-roles-skeleton-line--short" />
    </div>
  );
}

function GroupSelectCheckbox({
  allSelected,
  someSelected,
  onSelectAll,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: (select: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <label className="admin-roles-group-select">
      <input
        ref={ref}
        type="checkbox"
        checked={allSelected}
        onChange={(e) => onSelectAll(e.target.checked)}
      />
      <span>Tout sélectionner</span>
    </label>
  );
}

function NoticeCallout({ message, variant = "warning" }: { message: string; variant?: "warning" | "info" }) {
  return (
    <div
      className={`admin-roles-notice${variant === "info" ? " admin-roles-notice--info" : ""}`}
      role="status"
    >
      <span className="admin-roles-notice-icon" aria-hidden>
        {variant === "info" ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
      </span>
      <span>{message}</span>
    </div>
  );
}

function computeRoleLevel(active: number, total: number): { label: string; variant: "limited" | "standard" | "full" } | null {
  if (total === 0) return null;
  const pct = active / total;
  if (pct < 0.38) return { label: "Accès limité", variant: "limited" };
  if (pct < 0.72) return { label: "Accès standard", variant: "standard" };
  return { label: "Accès complet", variant: "full" };
}

export function AdminTabRoles() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [allPermissions, setAllPermissions] = useState<AdminPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AdminRole | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [permSearch, setPermSearch] = useState("");

  const groupedFull = useMemo(() => groupPermissionsByDomain(allPermissions), [allPermissions]);

  const filteredPermissions = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return allPermissions;
    return allPermissions.filter((p) => {
      const ui = getPermissionUi(p);
      return `${ui.label} ${ui.description}`.toLowerCase().includes(q);
    });
  }, [allPermissions, permSearch]);

  const groupedDisplay = useMemo(() => groupPermissionsByDomain(filteredPermissions), [filteredPermissions]);

  const roleLevel = useMemo(() => computeRoleLevel(selectedIds.size, allPermissions.length), [selectedIds, allPermissions.length]);

  useEffect(() => {
    if (modalOpen) setPermSearch("");
  }, [modalOpen]);

  const load = async () => {
    setLoading(true);
    setError("");
    setInfoNotice(null);
    try {
      const [r, p] = await Promise.all([adminGetRoles(), adminGetAllPermissions()]);
      setRoles(r);
      setAllPermissions(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openPermissions = async (role: AdminRole) => {
    if (role.is_system && role.organization_id == null) {
      setInfoNotice(
        "Ce rôle est défini au niveau plateforme : ses permissions sont figées et ne peuvent pas être modifiées depuis cet écran."
      );
      return;
    }
    setEditingRole(role);
    setError("");
    setInfoNotice(null);
    try {
      const perms = await adminGetRolePermissions(role.id);
      setSelectedIds(new Set(perms.map((p) => p.id)));
      setModalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };

  const togglePermission = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupPermissions = (permIds: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of permIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!editingRole) return;
    setSaving(true);
    setError("");
    try {
      await adminPutRolePermissions(editingRole.id, Array.from(selectedIds));
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-tab-roles">
        <AdminRolesSkeleton />
      </div>
    );
  }

  const noPermissions = allPermissions.length === 0;
  const totalPerms = allPermissions.length;
  const activeCount = selectedIds.size;
  const activeSummaryText =
    activeCount === 1
      ? `1 permission active sur ${totalPerms}`
      : `${activeCount} permissions actives sur ${totalPerms}`;

  const hasSearchResults = filteredPermissions.length > 0;
  const searchActive = permSearch.trim().length > 0;

  return (
    <div className="admin-tab-roles">
      <div style={{ marginBottom: "var(--spacing-24)" }}>
        <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)" }}>
          {roles.length} rôle(s)
        </span>
      </div>

      {infoNotice && <NoticeCallout message={infoNotice} variant="info" />}

      {error && !modalOpen && (
        <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
      )}

      {noPermissions && (
        <div className="admin-roles-empty" style={{ marginBottom: "var(--spacing-24)" }}>
          Aucune permission n’est enregistrée dans le catalogue RBAC pour le moment. L’attribution des droits sera disponible après configuration côté base.
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="sn-table sn-leads-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Nom</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: "var(--text-muted)", padding: "var(--spacing-24)", textAlign: "center" }}>
                  Aucun rôle à afficher.
                </td>
              </tr>
            ) : (
              roles.map((r) => {
                const isGlobalSystem = r.is_system && r.organization_id == null;
                return (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>
                      {isGlobalSystem ? (
                        <span className="admin-roles-type-badge--system">Système</span>
                      ) : (
                        <span className="admin-roles-type-badge--custom">Personnalisé</span>
                      )}
                    </td>
                    <td>
                      {isGlobalSystem ? (
                        <span style={{ color: "var(--text-muted)", fontSize: 13 }}>—</span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => openPermissions(r)} disabled={noPermissions}>
                          Permissions
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ModalShell
        open={modalOpen && !!editingRole}
        onClose={() => {
          setModalOpen(false);
          setError("");
        }}
        closeOnBackdropClick
        size="lg"
        title={editingRole ? `Permissions — ${editingRole.name || editingRole.code}` : ""}
        subtitle="Activez les droits par domaine métier. Les libellés décrivent l’effet concret dans l’application."
        bodyClassName="sn-modal-shell-body--flush"
        footer={
          <>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setModalOpen(false);
                setError("");
              }}
            >
              Annuler
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Enregistrement…" : "Sauvegarder"}
            </Button>
          </>
        }
      >
            {error && (
              <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)", padding: "0 var(--spacing-24)" }}>{error}</p>
            )}

            <div className="admin-roles-modal-summary" aria-live="polite" style={{ marginLeft: "var(--spacing-24)", marginRight: "var(--spacing-24)" }}>
              <div className="admin-roles-modal-summary-top">
                <p className="admin-roles-modal-summary-count">{activeSummaryText}</p>
                {roleLevel && (
                  <span
                    className={`admin-roles-level-badge admin-roles-level-badge--${roleLevel.variant}`}
                    title="Estimation selon la part des permissions activées dans le catalogue."
                  >
                    {roleLevel.label}
                  </span>
                )}
              </div>
              {totalPerms > 0 && (
                <div className="admin-roles-summary-bars">
                  {DOMAIN_ORDER.map((domainKey: PermissionDomainKey) => {
                    const permsInDomain = groupedFull.get(domainKey) ?? [];
                    if (permsInDomain.length === 0) return null;
                    const tot = permsInDomain.length;
                    const act = permsInDomain.filter((p) => selectedIds.has(p.id)).length;
                    const pct = tot > 0 ? Math.round((act / tot) * 100) : 0;
                    return (
                      <div key={domainKey} className="admin-roles-summary-row">
                        <span className="admin-roles-summary-domain" title={DOMAIN_TITLES[domainKey]}>
                          {DOMAIN_TITLES[domainKey]}
                        </span>
                        <div className="admin-roles-summary-track" aria-hidden>
                          <div className="admin-roles-summary-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="admin-roles-summary-nums">
                          {act} / {tot}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="admin-roles-modal-search" style={{ padding: "0 var(--spacing-24)" }}>
              <input
                id="admin-roles-perm-search"
                type="search"
                value={permSearch}
                onChange={(e) => setPermSearch(e.target.value)}
                placeholder="Rechercher par nom ou description…"
                autoComplete="off"
                aria-label="Rechercher une permission"
              />
            </div>

            <div style={{ marginBottom: "var(--spacing-24)", padding: "0 var(--spacing-24)" }}>
              {searchActive && !hasSearchResults ? (
                <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "var(--spacing-24)" }}>
                  Aucune permission ne correspond à votre recherche.
                </p>
              ) : null}
              {DOMAIN_ORDER.map((domainKey: PermissionDomainKey) => {
                const perms = groupedDisplay.get(domainKey) ?? [];
                if (perms.length === 0) return null;
                const fullDomain = groupedFull.get(domainKey) ?? [];
                const domainTotal = fullDomain.length;
                const domainActive = fullDomain.filter((p) => selectedIds.has(p.id)).length;
                const ids = perms.map((p) => p.id);
                const selectedInGroup = ids.filter((id) => selectedIds.has(id)).length;
                const allSelected = selectedInGroup === ids.length;
                const someSelected = selectedInGroup > 0;

                return (
                  <section key={domainKey} className="admin-roles-perm-group admin-roles-perm-group--panel">
                    <div className="admin-roles-perm-group-header">
                      <div className="admin-roles-perm-group-heading">
                        <h3 className="admin-roles-perm-group-title">{DOMAIN_TITLES[domainKey]}</h3>
                        <span className="admin-roles-domain-count">
                          {domainActive} / {domainTotal} activée{domainTotal > 1 ? "s" : ""}
                        </span>
                      </div>
                      <GroupSelectCheckbox
                        allSelected={allSelected}
                        someSelected={someSelected}
                        onSelectAll={(select) => toggleGroupPermissions(ids, select)}
                      />
                    </div>
                    {perms.map((p) => {
                      const ui = getPermissionUi(p);
                      const checked = selectedIds.has(p.id);
                      return (
                        <div
                          key={p.id}
                          className={`admin-roles-perm-row${checked ? " admin-roles-perm-row--checked" : ""}`}
                        >
                          <div className="admin-roles-perm-text">
                            <span className="admin-roles-perm-label">{ui.label}</span>
                            {ui.description ? (
                              <span className="admin-roles-perm-desc">{ui.description}</span>
                            ) : null}
                          </div>
                          <div className="admin-roles-perm-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(p.id)}
                              aria-label={ui.label}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
      </ModalShell>
    </div>
  );
}
