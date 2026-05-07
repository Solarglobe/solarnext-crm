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

function IconBuilding() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
    </svg>
  );
}

function IconBuildingModal() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
    </svg>
  );
}

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
                <td colSpan={3} className="org-tab-empty-cell">
                  <div className="org-tab-empty-state">
                    <div className="org-tab-empty-icon">
                      <IconBuilding />
                    </div>
                    <p className="org-tab-empty-title">Aucune agence</p>
                    <p className="org-tab-empty-lead">Créez votre première agence pour structurer vos équipes commerciales.</p>
                    <Button variant="primary" size="sm" type="button" onClick={openCreate}>
                      Nouvelle agence
                    </Button>
                  </div>
                </td>
              </tr>
            ) : (
              agencies.map((a) => (
                <tr key={a.id}>
                  <td className="org-tab-table__cell--strong">{a.name}</td>
                  <td>
                    {(teamCountByAgency[a.id] ?? 0) > 0 ? (
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {teamCountByAgency[a.id]} équipe{(teamCountByAgency[a.id] ?? 0) !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="org-tab-table__cell--muted">—</span>
                    )}
                  </td>
                  <td className="org-tab-table__cell--right">
                    <div className="org-tab-row-actions">
                      <button
                        type="button"
                        className="org-tab-icon-btn"
                        onClick={() => openEdit(a)}
                        aria-label={`Modifier ${a.name}`}
                        title="Modifier"
                      >
                        <OrgIconEdit />
                      </button>
                      <button
                        type="button"
                        className="org-tab-icon-btn org-tab-icon-btn--danger"
                        onClick={() => void handleDelete(a)}
                        aria-label={`Supprimer ${a.name}`}
                        title="Supprimer"
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
        subtitle={editingAgency ? "Mettez à jour le nom de cette agence." : "Créez une nouvelle agence pour regrouper vos équipes."}
        footer={
          <>
            <Button variant="secondary" size="sm" type="button" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" size="sm" type="submit" form="admin-agency-form">
              {editingAgency ? "Enregistrer" : "Créer l'agence"}
            </Button>
          </>
        }
      >
        <form id="admin-agency-form" onSubmit={handleSubmit}>
          <div className="org-modal-section">
            <div className="org-modal-section__header">
              <div className="org-modal-section__icon">
                <IconBuildingModal />
              </div>
              <div>
                <h3 className="org-modal-section__title">Informations</h3>
                <p className="org-modal-section__desc">Libellé interne visible dans l'admin et les listes.</p>
              </div>
            </div>
            <div className="org-modal-field-grid">
              <div className="org-modal-field">
                <label htmlFor="admin-agency-name">Nom de l&apos;agence</label>
                <input
                  id="admin-agency-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="sn-saas-input"
                  autoComplete="off"
                  placeholder="Ex. Agence Lyon"
                  autoFocus
                />
              </div>
            </div>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
