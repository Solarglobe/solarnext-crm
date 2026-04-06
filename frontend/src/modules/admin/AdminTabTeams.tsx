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
    return <p style={{ color: "var(--text-muted)" }}>Chargement…</p>;
  }

  return (
    <div className="admin-tab-teams">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--spacing-24)",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)" }}>
          {teams.length} équipe(s)
        </span>
        <Button variant="primary" onClick={openCreate}>
          Nouvelle équipe
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
              <th>Agence</th>
              <th>Nombre de membres</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.agency_name || "-"}</td>
                <td>-</td>
                <td>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    Éditer
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(t)}
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
        title={editingTeam ? "Modifier l'équipe" : "Nouvelle équipe"}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" form="admin-team-form">
              {editingTeam ? "Enregistrer" : "Créer"}
            </Button>
          </>
        }
      >
        <form id="admin-team-form" onSubmit={handleSubmit}>
          <div style={{ marginBottom: "var(--spacing-16)" }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "var(--text-muted)" }}>
              Nom
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="sn-input"
              style={{ height: 44, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ marginBottom: 0 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13, color: "var(--text-muted)" }}>
              Agence
            </label>
            <select
              value={form.agency_id}
              onChange={(e) => setForm((f) => ({ ...f, agency_id: e.target.value || undefined }))}
              className="sn-input"
              style={{ height: 44, width: "100%", boxSizing: "border-box" }}
            >
              <option value="">— Aucune —</option>
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      </ModalShell>
    </div>
  );
}
