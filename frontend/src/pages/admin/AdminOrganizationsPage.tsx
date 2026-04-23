/**
 * SUPER_ADMIN — liste des entreprises clientes et accès au compte (mode support).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { useOrganization } from "../../contexts/OrganizationContext";
import {
  adminArchiveOrganization,
  adminDeleteOrganization,
  adminImpersonateAndEnterSession,
  adminRestoreOrganization,
  fetchAdminOrganizations,
  postSuperAdminOrgSwitchAudit,
  type OrganizationListRow,
} from "../../services/organizations.service";
import "../../modules/quotes/quote-builder.css";

const LS_ORG = "solarnext_current_organization_id";
const LS_SUPER_EDIT = "solarnext_super_admin_edit_mode";
const ORG_NAME_SOLAR_GLOBE = "SolarGlobe";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeSlugPart(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function rowMatchesQuery(row: OrganizationListRow, q: string): boolean {
  if (!q.trim()) return true;
  const n = q.trim().toLowerCase();
  const name = (row.name || "").toLowerCase();
  const slug = (row.slug || normalizeSlugPart(row.name)).toLowerCase();
  return (
    name.includes(n) ||
    slug.includes(n) ||
    (row.id != null && row.id.toLowerCase().includes(n))
  );
}

export default function AdminOrganizationsPage() {
  const { jwtHomeOrganizationId } = useOrganization();
  const [rows, setRows] = useState<OrganizationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchAdminOrganizations({ includeArchived });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => rowMatchesQuery(r, debouncedSearch)),
    [rows, debouncedSearch]
  );

  const accessAccount = useCallback(async (org: OrganizationListRow) => {
    setBusyId(org.id);
    try {
      await postSuperAdminOrgSwitchAudit(org.id);
      localStorage.setItem(LS_ORG, org.id);
      localStorage.setItem(LS_SUPER_EDIT, "0");
      window.location.href = "/dashboard";
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur lors de l’accès au compte");
      setBusyId(null);
    }
  }, []);

  const isProtected = useCallback(
    (row: OrganizationListRow) => {
      if (row.name?.trim() === ORG_NAME_SOLAR_GLOBE) return { archive: true, delete: true };
      if (jwtHomeOrganizationId && row.id === jwtHomeOrganizationId) {
        return { archive: true, delete: true };
      }
      return { archive: false, delete: false };
    },
    [jwtHomeOrganizationId]
  );

  const handleArchive = useCallback(
    async (row: OrganizationListRow) => {
      if (isProtected(row).archive) return;
      if (!window.confirm(`Archiver l’organisation « ${row.name} » ?`)) return;
      setBusyId(row.id);
      try {
        await adminArchiveOrganization(row.id);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Archivage impossible");
      } finally {
        setBusyId(null);
      }
    },
    [isProtected, load]
  );

  const handleRestore = useCallback(
    async (row: OrganizationListRow) => {
      setBusyId(row.id);
      try {
        await adminRestoreOrganization(row.id);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Restauration impossible");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const handleImpersonate = useCallback(async (row: OrganizationListRow) => {
    if (row.is_archived) {
      window.alert("Impossible d’impersonner une organisation archivée.");
      return;
    }
    setBusyId(row.id);
    try {
      await adminImpersonateAndEnterSession(row.id);
      window.location.href = "/crm";
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Connexion en mode admin impossible");
      setBusyId(null);
    }
  }, []);

  const handleDelete = useCallback(
    async (row: OrganizationListRow) => {
      if (isProtected(row).delete) return;
      if (!window.confirm(`Étape 1/2 : confirmer la suppression définitive de « ${row.name} » ?`)) {
        return;
      }
      if (
        !window.confirm(
          `Étape 2/2 : cette action est irréversible. Supprimer « ${row.name} » ?`
        )
      ) {
        return;
      }
      setBusyId(row.id);
      try {
        await adminDeleteOrganization(row.id);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Suppression impossible");
      } finally {
        setBusyId(null);
      }
    },
    [isProtected, load]
  );

  return (
    <div className="sn-saas-page sn-saas-page--constrained">
      <header className="sn-saas-hero">
        <h1 className="sn-saas-hero__title">Organisations (super admin)</h1>
        <p className="sn-saas-hero__lead">
          Sélectionnez une entreprise pour ouvrir son CRM en mode support (en-tête{" "}
          <code className="sn-saas-inline-code">x-organization-id</code>).
        </p>
      </header>

      <div
        className="sn-saas-surface sn-saas-surface--pad sn-saas-surface--flush"
        style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}
      >
        <label className="sn-saas-muted" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220, flex: "1 1 220px" }}>
          <span className="sn-visually-hidden">Recherche</span>
          <input
            type="search"
            className="sn-saas-input"
            placeholder="Rechercher une organisation…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            aria-label="Rechercher une organisation"
          />
        </label>
        <label className="sn-saas-muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Afficher les organisations archivées
        </label>
      </div>

      {loading && <p className="sn-saas-muted">Chargement…</p>}
      {error && (
        <div className="sn-saas-surface sn-saas-callout-error" role="alert">
          <p className="sn-saas-callout-error__text">{error}</p>
          <Button variant="secondary" size="sm" type="button" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      )}

      {!loading && !error && (
        <div className="sn-saas-surface sn-saas-surface--flush">
          <div className="sn-saas-table-wrap">
            <table className="sn-saas-table">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>ID</th>
                  <th>Statut</th>
                  <th>Création</th>
                  <th className="sn-saas-table__cell--right">Leads</th>
                  <th className="sn-saas-table__cell--right">Clients</th>
                  <th className="sn-saas-table__cell--right">Compte</th>
                  <th className="sn-saas-table__cell--right" aria-label="Autres actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const prot = isProtected(row);
                  const archived = row.is_archived === true;
                  return (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        {row.slug ? (
                          <div className="sn-saas-table__cell--muted" style={{ fontSize: "0.85em" }}>
                            {row.slug}
                          </div>
                        ) : null}
                      </td>
                      <td className="sn-saas-table__cell--mono">{row.id}</td>
                      <td className="sn-saas-table__cell--muted">
                        {archived ? "Archivée" : "Active"}
                        {row.archived_at ? ` — ${formatDate(row.archived_at)}` : ""}
                      </td>
                      <td className="sn-saas-table__cell--muted">{formatDate(row.created_at)}</td>
                      <td className="sn-saas-table__cell--right">{row.leads_count ?? "—"}</td>
                      <td className="sn-saas-table__cell--right">{row.clients_count ?? "—"}</td>
                      <td className="sn-saas-table__cell--right" style={{ whiteSpace: "nowrap" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 6,
                          }}
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => void accessAccount(row)}
                          >
                            {busyId === row.id ? "…" : "Accéder au compte"}
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            type="button"
                            disabled={busyId !== null || archived}
                            title={archived ? "Organisation archivée" : "Jeton d’impersonation (2 h)"}
                            onClick={() => void handleImpersonate(row)}
                          >
                            {busyId === row.id ? "…" : "Se connecter"}
                          </Button>
                        </div>
                      </td>
                      <td className="sn-saas-table__cell--right" style={{ minWidth: 120 }}>
                        <details className="qb-actions-menu">
                          <summary className="qb-actions-menu__summary sn-btn sn-btn-ghost sn-btn-sm" style={{ listStyle: "none" }}>
                            Actions ▾
                          </summary>
                          <div className="qb-actions-menu__panel" role="menu">
                            {!archived && (
                              <button
                                type="button"
                                className="qb-actions-menu__item"
                                role="menuitem"
                                disabled={busyId !== null || prot.archive}
                                onClick={() => {
                                  (document.activeElement as HTMLElement | null)?.blur();
                                  void handleArchive(row);
                                }}
                              >
                                Archiver
                              </button>
                            )}
                            {archived && includeArchived && (
                              <button
                                type="button"
                                className="qb-actions-menu__item"
                                role="menuitem"
                                disabled={busyId !== null}
                                onClick={() => {
                                  (document.activeElement as HTMLElement | null)?.blur();
                                  void handleRestore(row);
                                }}
                              >
                                Restaurer
                              </button>
                            )}
                            <button
                              type="button"
                              className="qb-actions-menu__item qb-actions-menu__item--danger"
                              role="menuitem"
                              disabled={busyId !== null || prot.delete}
                              onClick={() => {
                                (document.activeElement as HTMLElement | null)?.blur();
                                void handleDelete(row);
                              }}
                            >
                              Supprimer
                            </button>
                            {(prot.archive || prot.delete) && (
                              <p className="sn-saas-muted" style={{ padding: "6px 10px", margin: 0, fontSize: 12 }}>
                                {row.name?.trim() === ORG_NAME_SOLAR_GLOBE
                                  ? "SolarGlobe est protégé."
                                  : "Votre organisation principale (JWT) est protégée."}
                              </p>
                            )}
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="sn-saas-empty">Aucune organisation.</p>}
          {rows.length > 0 && filtered.length === 0 && (
            <p className="sn-saas-empty">Aucun résultat pour « {debouncedSearch} ».</p>
          )}
        </div>
      )}
    </div>
  );
}
