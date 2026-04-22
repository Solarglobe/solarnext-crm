/**
 * CP-AUTO-CONVERT-ARCHIVE-08 — Tab Archives
 * CP-ARCHIVE-EXPORT-09 — Export CSV + recherche rapide
 */

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  adminGetArchives,
  adminRestoreArchive,
  adminExportArchivesCsv,
  type AdminArchiveItem,
} from "../../services/admin.api";
import { OrgIconUndo } from "./orgStructureTableIcons";

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
    return <p className="org-tab-loading">Chargement des archives…</p>;
  }

  return (
    <div className="admin-tab-archives org-structure-tab">
      <header className="org-tab-hero">
        <div className="org-tab-hero__text">
          <h2 className="org-tab-hero__title">Archives</h2>
          <p className="org-tab-hero__lead">
            Leads archivés : recherchez, exportez en CSV ou restaurez un dossier dans le pipeline.
          </p>
          <span className="org-tab-hero__meta">
            {filteredItems.length} sur {items.length} lead{items.length !== 1 ? "s" : ""}
            {search.trim() ? " (filtré)" : ""}
          </span>
        </div>
        <div className="org-tab-hero__actions">
          <Button
            variant="secondary"
            size="md"
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting || items.length === 0}
          >
            {exporting ? "Export…" : "Exporter CSV"}
          </Button>
        </div>
      </header>

      {error ? <p className="org-tab-alert">{error}</p> : null}

      {items.length > 0 ? (
        <div className="org-tab-toolbar">
          <div className="org-tab-toolbar__search">
            <input
              type="search"
              className="sn-input"
              placeholder="Rechercher nom, e-mail, téléphone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filtrer les archives"
            />
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="org-tab-table-wrap">
          <p className="org-tab-table__empty" style={{ margin: 0 }}>
            Aucun lead archivé.
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="org-tab-table-wrap">
          <p className="org-tab-table__empty" style={{ margin: 0 }}>
            Aucun résultat pour cette recherche.
          </p>
        </div>
      ) : (
        <div className="org-tab-table-wrap">
          <table className="org-tab-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Tél.</th>
                <th>Stage</th>
                <th>Raison</th>
                <th>Archivé le</th>
                <th>Par</th>
                <th className="org-tab-table__cell--right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td className="org-tab-table__cell--strong">{item.full_name || "—"}</td>
                  <td className="org-tab-table__cell--muted">{item.email || "—"}</td>
                  <td>{item.phone || "—"}</td>
                  <td>{item.stage_name || "—"}</td>
                  <td>{reasonLabel(item.archived_reason)}</td>
                  <td className="org-tab-table__cell--muted">{formatDate(item.archived_at)}</td>
                  <td className="org-tab-table__cell--muted">{item.archived_by_email || "—"}</td>
                  <td className="org-tab-table__cell--right">
                    <button
                      type="button"
                      className="org-tab-icon-btn"
                      onClick={() => void handleRestore(item)}
                      disabled={restoringId === item.id}
                      aria-label={`Restaurer ${item.full_name || item.email || "ce lead"}`}
                      title="Restaurer"
                    >
                      <OrgIconUndo />
                    </button>
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
