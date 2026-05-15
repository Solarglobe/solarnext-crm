/**
 * CP-AUTO-CONVERT-ARCHIVE-08 — Tab Archives
 * CP-ARCHIVE-EXPORT-09 — Export CSV + recherche rapide
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  adminGetArchives,
  adminRestoreArchive,
  adminExportArchivesCsv,
  type AdminArchiveItem,
} from "../../services/admin.api";
import { OrgIconUndo } from "./orgStructureTableIcons";

function IconArchive() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8"/>
      <rect x="1" y="3" width="22" height="5"/>
      <line x1="10" y1="12" x2="14" y2="12"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.35-4.35"/>
    </svg>
  );
}

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
            {exporting ? (
              "Export…"
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Exporter CSV
              </span>
            )}
          </Button>
        </div>
      </header>

      {error ? <p className="org-tab-alert">{error}</p> : null}

      {items.length > 0 ? (
        <div className="org-tab-toolbar">
          <div className="org-tab-toolbar__search-wrap">
            <IconSearch />
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
          <div className="org-tab-empty-state">
            <div className="org-tab-empty-icon">
              <IconArchive />
            </div>
            <p className="org-tab-empty-title">Aucun lead archivé</p>
            <p className="org-tab-empty-lead">Les leads marqués comme perdus ou archivés manuellement apparaîtront ici.</p>
          </div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="org-tab-table-wrap">
          <div className="org-tab-empty-state">
            <div className="org-tab-empty-icon">
              <IconSearch />
            </div>
            <p className="org-tab-empty-title">Aucun résultat</p>
            <p className="org-tab-empty-lead">Aucun lead ne correspond à «&nbsp;{search}&nbsp;».</p>
          </div>
        </div>
      ) : (
        <div className="org-tab-table-wrap">
          <table className="sn-ui-table org-tab-table">
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
                  <td>
                    {item.stage_name ? (
                      <span style={{ fontSize: 12, padding: "2px 7px", borderRadius: 5, background: "color-mix(in srgb, var(--text-primary) 7%, transparent)", fontWeight: 500 }}>
                        {item.stage_name}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    {reasonLabel(item.archived_reason) !== "—" ? (
                      <span style={{ fontSize: 12, padding: "2px 7px", borderRadius: 5, background: "color-mix(in srgb, #dc2626 8%, transparent)", color: "#dc2626", fontWeight: 500 }}>
                        {reasonLabel(item.archived_reason)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="org-tab-table__cell--muted">{formatDate(item.archived_at)}</td>
                  <td className="org-tab-table__cell--muted" style={{ fontSize: 12 }}>{item.archived_by_email || "—"}</td>
                  <td className="org-tab-table__cell--right">
                    <div className="org-tab-row-actions">
                      <button
                        type="button"
                        className="org-tab-icon-btn"
                        onClick={() => void handleRestore(item)}
                        disabled={restoringId === item.id}
                        aria-label={`Restaurer ${item.full_name || item.email || "ce lead"}`}
                        title="Restaurer dans le pipeline"
                      >
                        <OrgIconUndo />
                      </button>
                    </div>
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
