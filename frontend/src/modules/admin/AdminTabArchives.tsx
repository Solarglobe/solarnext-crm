/**
 * CP-AUTO-CONVERT-ARCHIVE-08 — Tab Archives
 * CP-ARCHIVE-EXPORT-09 — Export CSV + recherche rapide
 * Liste des leads archivés + restauration
 */

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  adminGetArchives,
  adminRestoreArchive,
  adminExportArchivesCsv,
  type AdminArchiveItem,
} from "../../services/admin.api";

export function AdminTabArchives() {
  const [items, setItems] = useState<AdminArchiveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { items: data } = await adminGetArchives();
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (item.full_name || "").toLowerCase().includes(q) ||
        (item.email || "").toLowerCase().includes(q) ||
        (item.phone || "").replace(/\s/g, "").includes(q.replace(/\s/g, ""))
    );
  }, [items, search]);

  const handleRestore = async (item: AdminArchiveItem) => {
    if (!confirm(`Restaurer le lead "${item.full_name || item.email}" ?`)) return;
    setError("");
    setRestoringId(item.id);
    try {
      await adminRestoreArchive(item.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur restauration");
    } finally {
      setRestoringId(null);
    }
  };

  const handleExportCsv = async () => {
    setError("");
    setExporting(true);
    try {
      await adminExportArchivesCsv();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur export");
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (d?: string | null) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("fr-FR");
    } catch {
      return "—";
    }
  };

  const reasonLabel = (r: string | null) => {
    if (!r) return "—";
    if (r === "LOST") return "Perdu";
    if (r === "MANUAL") return "Manuel";
    return r;
  };

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>Chargement…</p>;
  }

  return (
    <div className="admin-tab-archives">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "var(--spacing-24)",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)" }}>
          {filteredItems.length} lead(s) archivé(s)
          {search && ` (filtré sur ${items.length} total)`}
        </span>
        <button
          type="button"
          className="sn-btn sn-btn-primary"
          onClick={handleExportCsv}
          disabled={exporting || items.length === 0}
        >
          {exporting ? "Export…" : "Exporter CSV"}
        </button>
      </div>

      {items.length > 0 && (
        <div style={{ marginBottom: "var(--spacing-16)" }}>
          <input
            type="text"
            className="sn-input"
            placeholder="Rechercher nom, email, téléphone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>
      )}

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
      )}

      {items.length === 0 ? (
        <p style={{ color: "var(--text-muted)", padding: "var(--spacing-24)" }}>
          Aucun lead archivé.
        </p>
      ) : filteredItems.length === 0 ? (
        <p style={{ color: "var(--text-muted)", padding: "var(--spacing-24)" }}>
          Aucun résultat pour la recherche.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="sn-table sn-leads-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Téléphone</th>
                <th>Stage</th>
                <th>Raison</th>
                <th>Archivé le</th>
                <th>Par</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.full_name || "—"}</td>
                  <td>{item.email || "—"}</td>
                  <td>{item.phone || "—"}</td>
                  <td>{item.stage_name || "—"}</td>
                  <td>{reasonLabel(item.archived_reason)}</td>
                  <td>{formatDate(item.archived_at)}</td>
                  <td>{item.archived_by_email || "—"}</td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(item)}
                      disabled={restoringId === item.id}
                    >
                      {restoringId === item.id ? "Restauré…" : "Restaurer"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
