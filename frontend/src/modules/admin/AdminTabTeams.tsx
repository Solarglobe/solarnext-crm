/**
 * CP-ADMIN-UI-03 — Tab Équipes
 * CRUD équipes avec colonne Agence
 */

import React, { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import {
  adminGetTeams,
  adminGetAgencies,
  adminCreateTeam,
  adminUpdateTeam,
  adminDeleteTeam,
  type AdminTeam,
  type AdminAgency,
} from "../../services/admin.api";
import { OrgIconEdit, OrgIconTrash } from "./orgStructureTableIcons";

export function AdminTabTeams() {
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [agencies, setAgencies] = useState<AdminAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<AdminTeam | null>(null);
  const [form, setForm] = useState({ name: "", agency_id: "" as string | undefined });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [t, a] = await Promise.all([adminGetTeams(), adminGetAgencies()]);
      setTeams(t);
      setAgencies(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingTeam(null);
    setForm({ name: "", agency_id: "" });
    setModalOpen(true);
  };

  const openEdit = (t: AdminTeam) => {
    setEditingTeam(t);
    setForm({ name: t.name, agency_id: t.agency_id || "" });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setError("");
    try {
      const body = {
        name: form.name.trim(),
        agency_id: form.agency_id || undefined,
      };
      if (editingTeam) {
        await adminUpdateTeam(editingTeam.id, body);
      } else {
        await adminCreateTeam(body);
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleDelete = async (t: AdminTeam) => {
    if (!confirm(`Supprimer l'équipe "${t.name}" ?`)) return;
    setError("");
    try {
      await adminDeleteTeam(t.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression");
    }
  };

  if (loading) {
    return <p className="org-tab-loading">Chargement des équipes…</p>;
  }

  return (
    <div className="admin-tab-teams org-structure-tab">
      <header className="org-tab-hero">
        <div className="org-tab-hero__text">
          <h2 className="org-tab-hero__title">Équipes</h2>
          <p className="org-tab-hero__lead">
            Regroupez les utilisateurs par équipe et rattachez-les à une agence pour la structure commerciale et les droits.
          </p>
          <span className="org-tab-hero__meta">{teams.length} équipe{teams.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="org-tab-hero__actions">
          <Button variant="primary" size="md" type="button" onClick={openCreate}>
            Nouvelle équipe
          </Button>
        </div>
      </header>

      {error ? <p className="org-tab-alert">{error}</p> : null}

      <div className="org-tab-table-wrap">
        <table className="org-tab-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Agence</th>
              <th>Membres</th>
              <th className="org-tab-table__cell--right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teams.length === 0 ? (
              <tr>
                <td colSpan={4} className="org-tab-table__empty">
                  Aucune équipe pour le moment. Créez une équipe pour commencer.
                </td>
              </tr>
            ) : (
              teams.map((t) => (
                <tr key={t.id}>
                  <td className="org-tab-table__cell--strong">{t.name}</td>
                  <td>{t.agency_name || <span className="org-tab-table__cell--muted">—</span>}</td>
                  <td className="org-tab-table__cell--muted">—</td>
                  <td className="org-tab-table__cell--right">
                    <div className="org-tab-row-actions">
                      <button
                        type="button"
                        className="org-tab-icon-btn"
                        onClick={() => openEdit(t)}
                        aria-label={`Modifier ${t.name}`}
                      >
                        <OrgIconEdit />
                      </button>
                      <button
                        type="button"
                        className="org-tab-icon-btn org-tab-icon-btn--danger"
                        onClick={() => void handleDelete(t)}
                        aria-label={`Supprimer ${t.name}`}
                      >
                        <OrgIconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ModalShell
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="md"
        title={editingTeam ? "Modifier l'équipe" : "Nouvelle équipe"}
        subtitle="Nom affiché dans l’admin et rattachement optionnel à une agence."
        footer={
          <>
            <Button variant="secondary" size="sm" type="button" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" size="sm" type="submit" form="admin-team-form">
              {editingTeam ? "Enregistrer" : "Créer"}
            </Button>
          </>
        }
      >
        <form id="admin-team-form" onSubmit={handleSubmit}>
          <section className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Informations</h3>
            <div className="sn-saas-field-grid sn-saas-field-grid--2">
              <div>
                <label className="sn-saas-label" htmlFor="admin-team-name">
                  Nom de l&apos;équipe
                </label>
                <input
                  id="admin-team-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="sn-saas-input"
                  autoComplete="off"
                  placeholder="Ex. Commercial Sud"
                />
              </div>
              <div>
                <label className="sn-saas-label" htmlFor="admin-team-agency">
                  Agence
                </label>
                <select
                  id="admin-team-agency"
                  value={form.agency_id}
                  onChange={(e) => setForm((f) => ({ ...f, agency_id: e.target.value || undefined }))}
                  className="sn-saas-input"
                >
                  <option value="">— Aucune —</option>
                  {agencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        </form>
      </ModalShell>
    </div>
  );
}
