/**
 * SUPER_ADMIN — liste des entreprises clientes et accès au compte (mode support).
 */

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  fetchOrganizations,
  postSuperAdminOrgSwitchAudit,
  type OrganizationListRow,
} from "../../services/organizations.service";

const LS_ORG = "solarnext_current_organization_id";
const LS_SUPER_EDIT = "solarnext_super_admin_edit_mode";

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

export default function AdminOrganizationsPage() {
  const [rows, setRows] = useState<OrganizationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchOrganizations();
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accessAccount = useCallback(async (org: OrganizationListRow) => {
    setBusyId(org.id);
    try {
      await postSuperAdminOrgSwitchAudit(org.id);
      localStorage.setItem(LS_ORG, org.id);
      localStorage.setItem(LS_SUPER_EDIT, "0");
      window.location.href = "/crm.html/dashboard";
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erreur lors de l’accès au compte");
      setBusyId(null);
    }
  }, []);

  return (
    <div className="sn-saas-page sn-saas-page--constrained">
      <header className="sn-saas-hero">
        <h1 className="sn-saas-hero__title">Organisations (super admin)</h1>
        <p className="sn-saas-hero__lead">
          Sélectionnez une entreprise pour ouvrir son CRM en mode support (en-tête{" "}
          <code className="sn-saas-inline-code">x-organization-id</code>).
        </p>
      </header>

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
                  <th>Création</th>
                  <th className="sn-saas-table__cell--right">Leads</th>
                  <th className="sn-saas-table__cell--right">Clients</th>
                  <th className="sn-saas-table__cell--right" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td className="sn-saas-table__cell--mono">{row.id}</td>
                    <td className="sn-saas-table__cell--muted">{formatDate(row.created_at)}</td>
                    <td className="sn-saas-table__cell--right">{row.leads_count ?? "—"}</td>
                    <td className="sn-saas-table__cell--right">{row.clients_count ?? "—"}</td>
                    <td className="sn-saas-table__cell--right">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void accessAccount(row)}
                      >
                        {busyId === row.id ? "…" : "Accéder au compte"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="sn-saas-empty">Aucune organisation.</p>}
        </div>
      )}
    </div>
  );
}
