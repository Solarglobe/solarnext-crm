/**
 * CP-ADMIN-UI-03 — Tab Utilisateurs
 * CRUD + affectations teams/agencies
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
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
    status: f.status,
    roleIds: [...f.roleIds].sort(),
    teamIds: [...f.teamIds].sort(),
    agencyIds: [...f.agencyIds].sort(),
  });
}

function displayPrimaryName(u: AdminUser): string {
  const n = u.name?.trim();
  if (n) return n;
  return u.email || "—";
}

function UserNameCell({ u }: { u: AdminUser }) {
  const hasName = Boolean(u.name?.trim());
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
  if (!codes.length) return <span className="sn-badge crm-badge-muted">—</span>;
  const visible = codes.slice(0, 2);
  const rest = codes.length - 2;
  const fullList = codes.join(", ");
  return (
    <span title={codes.length > 2 ? fullList : undefined} style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {visible.map((r) => (
        <span key={r} className="sn-badge crm-badge-project">
          {r}
        </span>
      ))}
      {rest > 0 ? (
        <span className="sn-badge crm-badge-muted" title={fullList}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

function TeamAgencyCell({ names }: { names: string[] | undefined }) {
  if (names === undefined) {
    return <span className="sn-badge crm-badge-muted">—</span>;
  }
  if (names.length === 0) {
    return <span className="sn-badge crm-badge-muted">Aucune</span>;
  }
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {names.map((n, idx) => (
        <span
          key={`${n}-${idx}`}
          className="sn-badge"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
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

const emptyForm = (): UserFormState => ({
  email: "",
  password: "",
  status: "active",
  roleIds: [],
  teamIds: [],
  agencyIds: [],
});

export function AdminTabUsers() {
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

  const toggleRole = (id: string) => {
    setForm((f) => ({
      ...f,
      roleIds: f.roleIds.includes(id) ? f.roleIds.filter((x) => x !== id) : [...f.roleIds, id],
    }));
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

  const orgRoles = roles.filter((ro) => ro.organization_id != null || ro.is_system);

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
      <header className="admin-users-header">
        <div className="admin-users-header-text">
          <h2 className="admin-users-title">Utilisateurs</h2>
          <p className="admin-users-subtitle">Gérez les accès, rôles et la structure de votre entreprise</p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          Nouvel utilisateur
        </Button>
      </header>

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
      )}

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
        <div className="admin-users-table-wrap">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôles RBAC</th>
                <th>Équipes</th>
                <th>Agences</th>
                <th>Statut</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const m = userMemberships[u.id];
                return (
                  <tr key={u.id}>
                    <td>
                      <UserNameCell u={u} />
                    </td>
                    <td>
                      <RoleBadges codes={u.roles ?? []} />
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModalShell
        open={modalOpen}
        onClose={requestCloseModal}
        closeOnBackdropClick={false}
        size="lg"
        panelClassName="admin-users-modal-shell"
        title={editingUser ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
        subtitle={
          editingUser
            ? "Mettez à jour le compte, les rôles et les rattachements équipes et agences."
            : "Créez un compte avec un mot de passe initial, puis assignez les rôles et la structure."
        }
        footer={
          <>
            <Button variant="ghost" type="button" onClick={requestCloseModal}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" form="admin-user-form">
              {editingUser ? "Enregistrer" : "Créer"}
            </Button>
          </>
        }
        bodyClassName="sn-modal-shell-body--flush"
      >
            <form id="admin-user-form" onSubmit={handleSubmit}>
              <div className="admin-users-modal-body">
                <div className="admin-users-modal-section">
                  <h3 className="admin-users-modal-section-title">Informations</h3>
                  <div style={{ marginBottom: "var(--spacing-16)" }}>
                    <label className="admin-users-field-label" htmlFor="admin-user-email">
                      Email
                    </label>
                    <input
                      id="admin-user-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      required
                      className="sn-input"
                      style={{ width: "100%", height: 44, boxSizing: "border-box" }}
                      autoComplete="email"
                    />
                  </div>
                  {!editingUser && (
                    <div style={{ marginBottom: 0 }}>
                      <label className="admin-users-field-label" htmlFor="admin-user-password">
                        Mot de passe
                      </label>
                      <input
                        id="admin-user-password"
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        required={!editingUser}
                        className="sn-input"
                        style={{ width: "100%", height: 44, boxSizing: "border-box" }}
                        autoComplete="new-password"
                      />
                    </div>
                  )}
                  {editingUser && (
                    <>
                      <div style={{ marginBottom: "var(--spacing-16)" }}>
                        <label className="admin-users-field-label" htmlFor="admin-user-new-password">
                          Nouveau mot de passe (optionnel)
                        </label>
                        <input
                          id="admin-user-new-password"
                          type="password"
                          value={form.password}
                          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                          className="sn-input"
                          style={{ width: "100%", height: 44, boxSizing: "border-box" }}
                          autoComplete="new-password"
                        />
                      </div>
                      <div style={{ marginBottom: 0 }}>
                        <label className="admin-users-field-label" htmlFor="admin-user-status">
                          Statut
                        </label>
                        <select
                          id="admin-user-status"
                          value={form.status}
                          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                          className="sn-input"
                          style={{ width: "100%", height: 44, boxSizing: "border-box" }}
                        >
                          <option value="active">Actif</option>
                          <option value="inactive">Inactif</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                <div className="admin-users-modal-section">
                  <h3 className="admin-users-modal-section-title">Rôles</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {orgRoles.map((ro) => (
                      <label key={ro.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "var(--font-size-body)" }}>
                        <input type="checkbox" checked={form.roleIds.includes(ro.id)} onChange={() => toggleRole(ro.id)} />
                        {ro.code}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="admin-users-modal-section">
                  <h3 className="admin-users-modal-section-title">Équipes &amp; agences</h3>
                  <div style={{ marginBottom: "var(--spacing-16)" }}>
                    <label className="admin-users-field-label">Équipes</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {teams.map((tm) => (
                        <label key={tm.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "var(--font-size-body)" }}>
                          <input type="checkbox" checked={form.teamIds.includes(tm.id)} onChange={() => toggleTeam(tm.id)} />
                          {tm.name} {tm.agency_name ? `(${tm.agency_name})` : ""}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: 0 }}>
                    <label className="admin-users-field-label">Agences</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {agencies.map((ag) => (
                        <label key={ag.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "var(--font-size-body)" }}>
                          <input type="checkbox" checked={form.agencyIds.includes(ag.id)} onChange={() => toggleAgency(ag.id)} />
                          {ag.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
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
