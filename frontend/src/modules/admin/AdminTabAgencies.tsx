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
    return <p style={{ color: "var(--text-muted)" }}>Chargement…</p>;
  }

  return (
    <div className="admin-tab-agencies">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--spacing-24)",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)" }}>
          {agencies.length} agence(s)
        </span>
        <Button variant="primary" onClick={openCreate}>
          Nouvelle agence
        </Button>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
      )}

      <div style={{ overflowX: "auto" }}>
        <table className="sn-table sn-leads-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Nombre d'équipes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{teamCountByAgency[a.id] ?? 0}</td>
                <td>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                    Éditer
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(a)}
                    style={{ marginLeft: 8 }}
                  >
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ModalShell
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="sm"
        title={editingAgency ? "Modifier l'agence" : "Nouvelle agence"}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" form="admin-agency-form">
              {editingAgency ? "Enregistrer" : "Créer"}
            </Button>
          </>
        }
      >
        <form id="admin-agency-form" onSubmit={handleSubmit}>
          <div style={{ marginBottom: 0 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "var(--text-muted)" }}>
              Nom
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="sn-input"
              style={{ height: 44, width: "100%", boxSizing: "border-box" }}
            />
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
