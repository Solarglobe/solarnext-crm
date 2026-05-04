/**
 * CP-ADMIN-UI-03 — Tab Agences
 * CRUD agences
 */

import React, { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import {
  adminGetAgencies,
  adminGetTeams,
  adminCreateAgency,
  adminUpdateAgency,
  adminDeleteAgency,
  type AdminAgency,
  type AdminTeam,
} from "../../services/admin.api";
import { OrgIconEdit, OrgIconTrash } from "./orgStructureTableIcons";

export function AdminTabAgencies() {
  const [agencies, setAgencies] = useState<AdminAgency[]>([]);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgency, setEditingAgency] = useState<AdminAgency | null>(null);
  const [name, setName] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [a, t] = await Promise.all([adminGetAgencies(), adminGetTeams()]);
      setAgencies(a);
      setTeams(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const teamCountByAgency = teams.reduce<Record<string, number>>((acc, t) => {
    const aid = t.agency_id || "none";
    acc[aid] = (acc[aid] || 0) + 1;
    return acc;
  }, {});

  const openCreate = () => {
    setEditingAgency(null);
    setName("");
    setModalOpen(true);
  };

  const openEdit = (a: AdminAgency) => {
    setEditingAgency(a);
    setName(a.name);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      if (editingAgency) {
        await adminUpdateAgency(editingAgency.id, { name: name.trim() });
      } else {
        await adminCreateAgency({ name: name.trim() });
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleDelete = async (a: AdminAgency) => {
    if (!confirm(`Supprimer l'agence "${a.name}" ?`)) return;
    setError("");
    try {
      await adminDeleteAgency(a.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur suppression");
    }
  };

  if (loading) {
    return <p className="org-tab-loading">Chargement des agences…</p>;
  }

  return (
    <div className="admin-tab-agencies org-structure-tab">
      <header className="org-tab-hero">
        <div className="org-tab-hero__text">
          <h2 className="org-tab-hero__title">Agences</h2>
          <p className="org-tab-hero__lead">
            Structurez votre réseau : chaque agence peut regrouper plusieurs équipes et servir de repère pour l&apos;organisation.
          </p>
          <span className="org-tab-hero__meta">{agencies.length} agence{agencies.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="org-tab-hero__actions">
          <Button variant="primary" size="md" type="button" onClick={openCreate}>
            Nouvelle agence
          </Button>
        </div>
      </header>

      {error ? <p className="org-tab-alert">{error}</p> : null}

      <div className="org-tab-table-wrap">
        <table className="sn-ui-table org-tab-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Équipes rattachées</th>
              <th className="org-tab-table__cell--right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agencies.length === 0 ? (
              <tr>
                <td colSpan={3} className="org-tab-table__empty">
                  Aucune agence. Créez une agence avant d&apos;associer des équipes.
                </td>
              </tr>
            ) : (
              agencies.map((a) => (
                <tr key={a.id}>
                  <td className="org-tab-table__cell--strong">{a.name}</td>
                  <td>{teamCountByAgency[a.id] ?? 0}</td>
                  <td className="org-tab-table__cell--right">
                    <div className="org-tab-row-actions">
                      <button
                        type="button"
                        className="org-tab-icon-btn"
                        onClick={() => openEdit(a)}
                        aria-label={`Modifier ${a.name}`}
                      >
                        <OrgIconEdit />
                      </button>
                      <button
                        type="button"
                        className="org-tab-icon-btn org-tab-icon-btn--danger"
                        onClick={() => void handleDelete(a)}
                        aria-label={`Supprimer ${a.name}`}
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
        title={editingAgency ? "Modifier l'agence" : "Nouvelle agence"}
        subtitle="Libellé interne visible dans l’admin et les listes."
        footer={
          <>
            <Button variant="secondary" size="sm" type="button" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" size="sm" type="submit" form="admin-agency-form">
              {editingAgency ? "Enregistrer" : "Créer"}
            </Button>
          </>
        }
      >
        <form id="admin-agency-form" onSubmit={handleSubmit}>
          <section className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Informations</h3>
            <div>
              <label className="sn-saas-label" htmlFor="admin-agency-name">
                Nom de l&apos;agence
              </label>
              <input
                id="admin-agency-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="sn-saas-input"
                autoComplete="off"
                placeholder="Ex. Agence Lyon"
              />
            </div>
          </section>
        </form>
      </ModalShell>
    </div>
  );
}
