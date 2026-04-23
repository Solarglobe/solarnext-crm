/**
 * CP-ADMIN-UI-03 — Tab Utilisateurs
 * CRUD + affectations teams/agencies
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { ModalShell } from "../../components/ui/ModalShell";
import {
  adminGetUsers,
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  adminGetUserTeams,
  adminPutUserTeams,
  adminGetUserAgencies,
  adminPutUserAgencies,
  adminGetRoles,
  adminGetTeams,
  adminGetAgencies,
  type AdminUser,
  type AdminRole,
  type AdminTeam,
  type AdminAgency,
} from "../../services/admin.api";
import { useOrganization } from "../../contexts/OrganizationContext";
import { getAuthToken } from "../../services/api";
import { decodeJwtPayloadUnsafe } from "../../services/auth.service";
import { adminUserImpersonateAndEnterSession } from "../../services/organizations.service";
import "./admin-tab-users.css";

type UserMemberships = Record<
  string,
  {
    teamNames: string[];
    agencyNames: string[];
  }
>;

type UserFormState = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  status: string;
  roleIds: string[];
  teamIds: string[];
  agencyIds: string[];
};

function showAdminToast(message: string) {
  const toast = document.createElement("div");
  toast.className = "planning-toast planning-toast-success";
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 10001;
    padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background: var(--success, #22c55e);
    color: #fff;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function serializeForm(f: UserFormState): string {
  return JSON.stringify({
    email: f.email,
    password: f.password,
    first_name: f.first_name,
    last_name: f.last_name,
    status: f.status,
    roleIds: [...f.roleIds].sort(),
    teamIds: [...f.teamIds].sort(),
    agencyIds: [...f.agencyIds].sort(),
  });
}

function displayPrimaryName(u: AdminUser): string {
  const fromParts = [u.first_name?.trim(), u.last_name?.trim()].filter(Boolean).join(" ").trim();
  if (fromParts) return fromParts;
  const n = u.name?.trim();
  if (n) return n;
  return u.email || "—";
}

function UserNameCell({ u }: { u: AdminUser }) {
  const hasName = Boolean(
    [u.first_name?.trim(), u.last_name?.trim()].filter(Boolean).join(" ").trim() || u.name?.trim()
  );
  const primary = displayPrimaryName(u);
  const email = u.email || "";
  return (
    <div>
      <span className="admin-users-cell-name-primary">{primary}</span>
      {hasName && email ? <span className="admin-users-cell-name-email">{email}</span> : null}
    </div>
  );
}

function RoleBadges({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="admin-users-pill admin-users-pill--muted">—</span>;
  const visible = codes.slice(0, 2);
  const rest = codes.length - 2;
  const fullList = codes.join(", ");
  return (
    <span className="admin-users-pill-row" title={codes.length > 2 ? fullList : undefined}>
      {visible.map((r) => (
        <span key={r} className="admin-users-pill admin-users-pill--role">
          {r}
        </span>
      ))}
      {rest > 0 ? (
        <span className="admin-users-pill admin-users-pill--muted" title={fullList}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

function TeamAgencyCell({ names }: { names: string[] | undefined }) {
  if (names === undefined) {
    return <span className="admin-users-pill admin-users-pill--muted">—</span>;
  }
  if (names.length === 0) {
    return <span className="admin-users-pill admin-users-pill--muted">Aucune</span>;
  }
  return (
    <span className="admin-users-pill-row">
      {names.map((n, idx) => (
        <span key={`${n}-${idx}`} className="admin-users-pill admin-users-pill--tag">
          {n}
        </span>
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  const inactive = status === "inactive";
  const dotClass =
    active ? "admin-users-status-dot admin-users-status-dot--active" : "admin-users-status-dot admin-users-status-dot--inactive";
  if (active) {
    return (
      <span className="admin-users-status">
        <span className={dotClass} aria-hidden />
        <span className="sn-badge crm-badge-ok">Actif</span>
      </span>
    );
  }
  if (inactive) {
    return (
      <span className="admin-users-status">
        <span className={dotClass} aria-hidden />
        <span className="sn-badge crm-badge-muted">Inactif</span>
      </span>
    );
  }
  return (
    <span className="admin-users-status">
      <span className="admin-users-status-dot admin-users-status-dot--inactive" aria-hidden />
      <span className="sn-badge crm-badge-muted">{status}</span>
    </span>
  );
}

function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function IconUsersEmpty() {
  return (
    <svg className="admin-users-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconSearchFin({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type UserStatusFilter = "all" | "active" | "inactive";

function normSearch(s: string) {
  return s.trim().toLowerCase();
}

function normRoleCode(code: string | undefined) {
  return (code || "").trim().toUpperCase();
}

function isRoleCodeSelected(roleIds: string[], orgRolesList: AdminRole[], code: string) {
  const n = normRoleCode(code);
  return orgRolesList.some((r) => normRoleCode(r.code) === n && roleIds.includes(r.id));
}

const emptyForm = (): UserFormState => ({
  email: "",
  password: "",
  first_name: "",
  last_name: "",
  status: "active",
  roleIds: [],
  teamIds: [],
  agencyIds: [],
});

export function AdminTabUsers() {
  const { isSuperAdmin: viewerIsSuperAdmin, currentOrganization } = useOrganization();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [agencies, setAgencies] = useState<AdminAgency[]>([]);
  const [userMemberships, setUserMemberships] = useState<UserMemberships>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<AdminUser | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const formSnapshotRef = useRef<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const [impersonateBusyId, setImpersonateBusyId] = useState<string | null>(null);

  const handleImpersonateUser = useCallback(
    async (u: AdminUser) => {
      const orgName = currentOrganization?.name?.trim();
      if (!orgName) {
        window.alert("Nom d’organisation indisponible.");
        return;
      }
      const selfId = decodeJwtPayloadUnsafe(getAuthToken() || "")?.userId;
      if (selfId && u.id === selfId) {
        window.alert("Vous ne pouvez pas vous impersoner vous-même.");
        return;
      }
      setImpersonateBusyId(u.id);
      try {
        await adminUserImpersonateAndEnterSession(u.id, {
          userName: displayPrimaryName(u),
          organizationName: orgName,
        });
        window.location.href = "/crm";
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Impersonation impossible");
        setImpersonateBusyId(null);
      }
    },
    [currentOrganization?.name]
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [u, r, t, a] = await Promise.all([
        adminGetUsers(),
        adminGetRoles(),
        adminGetTeams(),
        adminGetAgencies(),
      ]);
      setUsers(u);
      setRoles(r);
      setTeams(t);
      setAgencies(a);

      const membershipResults = await Promise.allSettled(
        u.map(async (user) => {
          const [uts, uas] = await Promise.all([
            adminGetUserTeams(user.id),
            adminGetUserAgencies(user.id),
          ]);
          return {
            userId: user.id,
            teamNames: uts.map((x) => x.team_name).filter(Boolean),
            agencyNames: uas.map((x) => x.agency_name).filter(Boolean),
          };
        })
      );
      const mem: UserMemberships = {};
      for (const res of membershipResults) {
        if (res.status === "fulfilled") {
          const { userId, teamNames, agencyNames } = res.value;
          mem[userId] = { teamNames, agencyNames };
        }
      }
      setUserMemberships(mem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isFormDirty = useCallback(() => serializeForm(form) !== formSnapshotRef.current, [form]);

  const requestCloseModal = useCallback(() => {
    if (isFormDirty()) {
      const ok = window.confirm("Abandonner les modifications non enregistrées ?");
      if (!ok) return;
    }
    setModalOpen(false);
  }, [isFormDirty]);

  const openCreate = () => {
    setEditingUser(null);
    const initial = emptyForm();
    setForm(initial);
    formSnapshotRef.current = serializeForm(initial);
    setModalOpen(true);
  };

  const openEdit = async (user: AdminUser) => {
    setEditingUser(user);
    const roleIds = (user.roles || []).map((code) => {
      const ro = roles.find((x) => x.code === code);
      return ro?.id || "";
    }).filter(Boolean);
    const base: UserFormState = {
      email: user.email,
      password: "",
      first_name: user.first_name?.trim() ?? "",
      last_name: user.last_name?.trim() ?? "",
      status: user.status || "active",
      roleIds,
      teamIds: [],
      agencyIds: [],
    };
    setForm(base);
    formSnapshotRef.current = serializeForm(base);
    setModalOpen(true);
    try {
      const [userTeams, userAgencies] = await Promise.all([
        adminGetUserTeams(user.id),
        adminGetUserAgencies(user.id),
      ]);
      const merged: UserFormState = {
        ...base,
        teamIds: userTeams.map((ut) => ut.team_id),
        agencyIds: userAgencies.map((ua) => ua.agency_id),
      };
      setForm(merged);
      formSnapshotRef.current = serializeForm(merged);
    } catch {
      formSnapshotRef.current = serializeForm(base);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (editingUser) {
        await adminUpdateUser(editingUser.id, {
          email: form.email,
          status: form.status,
          first_name: form.first_name.trim() || null,
          last_name: form.last_name.trim() || null,
          ...(form.password ? { password: form.password } : {}),
          roleIds: form.roleIds,
        });
        await adminPutUserTeams(editingUser.id, form.teamIds);
        await adminPutUserAgencies(editingUser.id, form.agencyIds);
        showAdminToast("Utilisateur mis à jour");
      } else {
        if (!form.password) throw new Error("Mot de passe requis");
        const created = await adminCreateUser({
          email: form.email,
          password: form.password,
          first_name: form.first_name.trim() || undefined,
          last_name: form.last_name.trim() || undefined,
          roleIds: form.roleIds,
        });
        if (form.teamIds.length > 0 || form.agencyIds.length > 0) {
          await adminPutUserTeams(created.id, form.teamIds);
          await adminPutUserAgencies(created.id, form.agencyIds);
        }
        showAdminToast("Utilisateur créé");
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmUser) return;
    setError("");
    setDeleteSubmitting(true);
    try {
      await adminDeleteUser(deleteConfirmUser.id);
      setDeleteConfirmUser(null);
      showAdminToast("Utilisateur supprimé");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression");
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const toggleTeam = (id: string) => {
    setForm((f) => ({
      ...f,
      teamIds: f.teamIds.includes(id) ? f.teamIds.filter((x) => x !== id) : [...f.teamIds, id],
    }));
  };

  const toggleAgency = (id: string) => {
    setForm((f) => ({
      ...f,
      agencyIds: f.agencyIds.includes(id) ? f.agencyIds.filter((x) => x !== id) : [...f.agencyIds, id],
    }));
  };

  const orgRoles = roles.filter((ro) => {
    if (!viewerIsSuperAdmin && normRoleCode(ro.code) === "SUPER_ADMIN") return false;
    return ro.organization_id != null || ro.is_system;
  });

  const orgRolesUnique = useMemo(() => {
    const seen = new Set<string>();
    const out: AdminRole[] = [];
    for (const ro of orgRoles) {
      const k = normRoleCode(ro.code);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(ro);
    }
    return out;
  }, [orgRoles]);

  const toggleRoleByCode = useCallback(
    (code: string) => {
      const same = orgRoles.filter((r) => normRoleCode(r.code) === normRoleCode(code));
      if (!same.length) return;
      const canonical = same[0];
      const dropIds = new Set(same.map((r) => r.id));
      setForm((f) => {
        const has = same.some((r) => f.roleIds.includes(r.id));
        const next = f.roleIds.filter((id) => !dropIds.has(id));
        if (has) return { ...f, roleIds: next };
        return { ...f, roleIds: [...next, canonical.id] };
      });
    },
    [orgRoles],
  );

  const filteredUsers = useMemo(() => {
    let list = users;
    const q = normSearch(searchQuery);
    if (q) {
      list = list.filter((u) => {
        const name = normSearch(displayPrimaryName(u));
        const email = normSearch(u.email || "");
        const rolesStr = (u.roles || []).join(" ").toLowerCase();
        const m = userMemberships[u.id];
        const teams = (m?.teamNames || []).join(" ").toLowerCase();
        const agencies = (m?.agencyNames || []).join(" ").toLowerCase();
        return (
          name.includes(q) ||
          email.includes(q) ||
          rolesStr.includes(q) ||
          teams.includes(q) ||
          agencies.includes(q) ||
          String(u.id).toLowerCase().includes(q)
        );
      });
    }
    if (statusFilter !== "all") {
      list = list.filter((u) => (u.status || "active") === statusFilter);
    }
    return list;
  }, [users, userMemberships, searchQuery, statusFilter]);

  const resetListFilters = useCallback(() => {
    setSearchQuery("");
    setStatusFilter("all");
  }, []);

  if (loading) {
    return (
      <div className="admin-tab-users">
        <p style={{ color: "var(--text-muted)" }}>Chargement…</p>
      </div>
    );
  }

  const showEmpty = users.length === 0 && !error;

  return (
    <div className="admin-tab-users">
      {error ? <p className="admin-users-error">{error}</p> : null}

      {showEmpty ? (
        <div className="admin-users-empty">
          <IconUsersEmpty />
          <h3 className="admin-users-empty-title">Aucun utilisateur</h3>
          <p className="admin-users-empty-desc">Commencez par créer votre premier utilisateur pour inviter des membres et leur attribuer des rôles.</p>
          <Button variant="primary" onClick={openCreate}>
            Nouvel utilisateur
          </Button>
        </div>
      ) : users.length === 0 ? null : (
        <>
          <div className="sn-leads-toolbar-wrap">
            <div className="sn-leads-filters-card" role="search" aria-label="Filtres utilisateurs">
              <div className="sn-leads-filters-primary">
                <div className="sn-leads-filters-search">
                  <IconSearchFin className="sn-leads-filters-search__icon" />
                  <input
                    id="admin-users-search"
                    type="search"
                    className="sn-leads-filters-search__input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher nom, email, rôle, équipe…"
                    aria-label="Rechercher un utilisateur"
                    autoComplete="off"
                  />
                </div>
                <div className="sn-leads-filters-field">
                  <label htmlFor="admin-users-status-filter" className="sn-leads-filters-field__label">
                    Statut
                  </label>
                  <select
                    id="admin-users-status-filter"
                    className="sn-leads-filters-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as UserStatusFilter)}
                  >
                    <option value="all">Tous</option>
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                  </select>
                </div>
                <div className="admin-users-toolbar-tail">
                  <button type="button" className="sn-leads-filters-reset" onClick={resetListFilters}>
                    Réinitialiser
                  </button>
                  <Button variant="primary" size="sm" type="button" onClick={openCreate}>
                    Nouvel utilisateur
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <p className="admin-users-filter-empty">Aucun utilisateur ne correspond à ces filtres.</p>
          ) : (
            <div className="admin-users-table-wrap admin-users-table-wrap--saas">
              <table className="admin-users-table admin-users-table--saas">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Rôles RBAC</th>
                    <th>Équipes</th>
                    <th>Agences</th>
                    <th>Statut</th>
                    <th className="admin-users-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const m = userMemberships[u.id];
                    const selfId = decodeJwtPayloadUnsafe(getAuthToken() || "")?.userId;
                    const canImpersonate =
                      viewerIsSuperAdmin &&
                      u.status === "active" &&
                      (!selfId || u.id !== selfId) &&
                      !(u.roles || []).some((c) => String(c).toUpperCase() === "SUPER_ADMIN");
                    return (
                      <tr key={u.id}>
                        <td>
                          <UserNameCell u={u} />
                        </td>
                        <td>
                          <RoleBadges
                            codes={
                              viewerIsSuperAdmin
                                ? (u.roles ?? [])
                                : (u.roles ?? []).filter((c) => normRoleCode(c) !== "SUPER_ADMIN")
                            }
                          />
                        </td>
                        <td>
                          <TeamAgencyCell names={m?.teamNames} />
                        </td>
                        <td>
                          <TeamAgencyCell names={m?.agencyNames} />
                        </td>
                        <td>
                          <StatusBadge status={u.status} />
                        </td>
                        <td>
                          <div className="admin-users-actions">
                            <button
                              type="button"
                              className="admin-users-icon-btn"
                              onClick={() => openEdit(u)}
                              aria-label={`Modifier ${displayPrimaryName(u)}`}
                            >
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              className="admin-users-icon-btn admin-users-icon-btn--danger"
                              onClick={() => setDeleteConfirmUser(u)}
                              aria-label={`Supprimer ${displayPrimaryName(u)}`}
                            >
                              <IconTrash />
                            </button>
                            {canImpersonate && (
                              <button
                                type="button"
                                className="admin-users-impersonate-link"
                                disabled={impersonateBusyId !== null}
                                onClick={() => void handleImpersonateUser(u)}
                              >
                                {impersonateBusyId === u.id ? "…" : "Se connecter en tant que cet utilisateur"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ModalShell
        open={modalOpen}
        onClose={requestCloseModal}
        closeOnBackdropClick={false}
        size="xl"
        backdropClassName="admin-users-modal-backdrop-premium"
        panelClassName="admin-users-modal-shell admin-users-modal-shell--premium"
        title={editingUser ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
        subtitle={
          editingUser
            ? "Mettez à jour le compte, les rôles et les rattachements équipes et agences."
            : "Créez un compte avec un mot de passe initial, puis assignez les rôles et la structure."
        }
        footer={
          <div className="admin-users-modal-footer-actions">
            <Button variant="ghost" type="button" size="lg" onClick={requestCloseModal}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" size="lg" form="admin-user-form">
              {editingUser ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        }
        bodyClassName="admin-users-modal-shell-body"
      >
        <form id="admin-user-form" onSubmit={handleSubmit}>
          <div className="admin-users-modal-stack">
            <section className="admin-users-modal-block" aria-labelledby="admin-user-block-info">
              <h3 id="admin-user-block-info" className="admin-users-modal-block-title">
                Informations
              </h3>
              <div className="admin-users-modal-fields">
                <div className="admin-users-modal-field admin-users-modal-field--full">
                  <label className="admin-users-modal-label" htmlFor="admin-user-email">
                    Email
                  </label>
                  <input
                    id="admin-user-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                    className="sn-input admin-users-modal-input"
                    autoComplete="email"
                  />
                </div>
                <div className="admin-users-modal-field-row">
                  <div className="admin-users-modal-field">
                    <label className="admin-users-modal-label" htmlFor="admin-user-first-name">
                      Prénom
                    </label>
                    <input
                      id="admin-user-first-name"
                      type="text"
                      value={form.first_name}
                      onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                      className="sn-input admin-users-modal-input"
                      autoComplete="given-name"
                      placeholder="Optionnel"
                    />
                  </div>
                  <div className="admin-users-modal-field">
                    <label className="admin-users-modal-label" htmlFor="admin-user-last-name">
                      Nom
                    </label>
                    <input
                      id="admin-user-last-name"
                      type="text"
                      value={form.last_name}
                      onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                      className="sn-input admin-users-modal-input"
                      autoComplete="family-name"
                      placeholder="Optionnel"
                    />
                  </div>
                </div>
                {!editingUser ? (
                  <div className="admin-users-modal-field admin-users-modal-field--full">
                    <label className="admin-users-modal-label" htmlFor="admin-user-password">
                      Mot de passe
                    </label>
                    <input
                      id="admin-user-password"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      required={!editingUser}
                      className="sn-input admin-users-modal-input"
                      autoComplete="new-password"
                    />
                  </div>
                ) : (
                  <div className="admin-users-modal-field admin-users-modal-field--full">
                    <label className="admin-users-modal-label" htmlFor="admin-user-new-password">
                      Nouveau mot de passe (optionnel)
                    </label>
                    <input
                      id="admin-user-new-password"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className="sn-input admin-users-modal-input"
                      autoComplete="new-password"
                    />
                  </div>
                )}
              </div>
            </section>

            {editingUser ? (
              <section className="admin-users-modal-block" aria-labelledby="admin-user-block-status">
                <h3 id="admin-user-block-status" className="admin-users-modal-block-title">
                  Statut
                </h3>
                <div className="admin-users-modal-field admin-users-modal-field--full">
                  <label className="admin-users-modal-label" htmlFor="admin-user-status">
                    État du compte
                  </label>
                  <select
                    id="admin-user-status"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="sn-input admin-users-modal-input admin-users-modal-select"
                  >
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                  </select>
                </div>
              </section>
            ) : null}

            <section className="admin-users-modal-block" aria-labelledby="admin-user-block-roles">
              <h3 id="admin-user-block-roles" className="admin-users-modal-block-title">
                Rôles
              </h3>
              <p className="admin-users-modal-block-hint">Sélectionnez un ou plusieurs rôles appliqués à ce compte.</p>
              <div className="admin-users-role-grid" role="group" aria-label="Rôles RBAC">
                {orgRolesUnique.map((ro) => {
                  const selected = isRoleCodeSelected(form.roleIds, orgRoles, ro.code);
                  const labelPrimary = ro.name?.trim() || ro.code;
                  const showCode = Boolean(ro.name?.trim());
                  return (
                    <button
                      key={ro.id}
                      type="button"
                      className={`admin-users-role-card${selected ? " admin-users-role-card--selected" : ""}`}
                      onClick={() => toggleRoleByCode(ro.code)}
                      aria-pressed={selected}
                    >
                      <span className="admin-users-role-card__check" aria-hidden>
                        {selected ? <IconCheck className="admin-users-role-card__check-icon" /> : null}
                      </span>
                      <span className="admin-users-role-card__text">
                        <span className="admin-users-role-card__title">{labelPrimary}</span>
                        {showCode ? <span className="admin-users-role-card__code">{ro.code}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="admin-users-modal-block" aria-labelledby="admin-user-block-teams">
              <h3 id="admin-user-block-teams" className="admin-users-modal-block-title">
                Équipes &amp; agences
              </h3>
              <div className="admin-users-modal-subsection">
                <span className="admin-users-modal-subsection-label" id="admin-user-teams-label">
                  Équipes
                </span>
                <div className="admin-users-checkbox-grid" role="group" aria-labelledby="admin-user-teams-label">
                  {teams.map((tm) => (
                    <label key={tm.id} className="admin-users-struct-option">
                      <input type="checkbox" className="admin-users-struct-option__input" checked={form.teamIds.includes(tm.id)} onChange={() => toggleTeam(tm.id)} />
                      <span className="admin-users-struct-option__text">
                        {tm.name}
                        {tm.agency_name ? <span className="admin-users-struct-option__meta"> ({tm.agency_name})</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="admin-users-modal-subsection">
                <span className="admin-users-modal-subsection-label" id="admin-user-agencies-label">
                  Agences
                </span>
                <div className="admin-users-checkbox-grid" role="group" aria-labelledby="admin-user-agencies-label">
                  {agencies.map((ag) => (
                    <label key={ag.id} className="admin-users-struct-option">
                      <input type="checkbox" className="admin-users-struct-option__input" checked={form.agencyIds.includes(ag.id)} onChange={() => toggleAgency(ag.id)} />
                      <span className="admin-users-struct-option__text">{ag.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </form>
      </ModalShell>

      <ConfirmModal
        open={Boolean(deleteConfirmUser)}
        title="Supprimer cet utilisateur ?"
        message="Cette action est irréversible. L'utilisateur ne pourra plus accéder au système."
        confirmLabel={deleteSubmitting ? "Suppression…" : "Supprimer"}
        cancelLabel="Annuler"
        variant="danger"
        elevation="stacked"
        confirmDisabled={deleteSubmitting}
        cancelDisabled={deleteSubmitting}
        onCancel={() => setDeleteConfirmUser(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
