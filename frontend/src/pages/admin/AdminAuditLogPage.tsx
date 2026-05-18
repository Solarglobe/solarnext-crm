import { useEffect, useMemo, useState } from "react";
import {
  downloadAuditLogCsv,
  fetchAuditLogs,
  type AuditLogFilters,
  type AuditLogRow,
} from "../../services/auditLog.service";
import "./admin-audit-log-page.css";

const ACTIONS = [
  "",
  "AUTH_LOGIN_SUCCESS",
  "AUTH_LOGIN_FAILURE",
  "AUTH_PASSWORD_CHANGED",
  "AUTH_EMAIL_CHANGED",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "SESSION_REVOKED",
  "SESSION_REVOKED_OTHERS",
  "SUPER_ADMIN_ORG_IMPERSONATE",
  "SUPER_ADMIN_USER_IMPERSONATE",
  "RGPD_EXPORT_REQUESTED",
  "AUDIT_LOG_VIEWED",
  "AUDIT_LOG_EXPORTED",
];

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR");
}

export default function AdminAuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<AuditLogFilters>({ limit: 50, offset: 0 });

  const page = Math.floor((filters.offset ?? 0) / (filters.limit ?? 50)) + 1;
  const maxPage = Math.max(1, Math.ceil(total / (filters.limit ?? 50)));

  const queryFilters = useMemo(() => filters, [filters]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAuditLogs(queryFilters);
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [queryFilters]);

  const patchFilters = (patch: Partial<AuditLogFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch, offset: patch.offset ?? 0 }));
  };

  const exportCsv = async () => {
    try {
      const blob = await downloadAuditLogCsv(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-log.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export impossible");
    }
  };

  return (
    <div className="admin-audit">
      <header className="admin-audit__head">
        <div>
          <h1>Journal d'audit</h1>
          <p>Evenements d'authentification, d'acces et de securite. Separe du mutation_log metier.</p>
        </div>
        <button type="button" className="sn-btn sn-btn-secondary" onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </header>

      <section className="admin-audit__filters">
        <label>
          <span>Type</span>
          <select value={filters.action ?? ""} onChange={(event) => patchFilters({ action: event.target.value || undefined })}>
            {ACTIONS.map((action) => (
              <option key={action || "all"} value={action}>{action || "Tous"}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Utilisateur</span>
          <input value={filters.userId ?? ""} onChange={(event) => patchFilters({ userId: event.target.value || undefined })} placeholder="UUID utilisateur" />
        </label>
        <label>
          <span>Depuis</span>
          <input type="date" value={filters.dateFrom ?? ""} onChange={(event) => patchFilters({ dateFrom: event.target.value || undefined })} />
        </label>
        <label>
          <span>Jusqu'au</span>
          <input type="date" value={filters.dateTo ?? ""} onChange={(event) => patchFilters({ dateTo: event.target.value || undefined })} />
        </label>
      </section>

      {error ? <p className="admin-audit__error">{error}</p> : null}

      <section className="admin-audit__table-wrap">
        <table className="admin-audit__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Utilisateur</th>
              <th>IP</th>
              <th>Cible</th>
              <th>Route</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}>Chargement...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7}>Aucun evenement trouve.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td><code>{row.action}</code></td>
                  <td>{row.user_email || row.user_name || row.user_id || "-"}</td>
                  <td>{row.ip_address || "-"}</td>
                  <td>{row.target_label || row.entity_type}</td>
                  <td>{row.method || ""} {row.route || ""}</td>
                  <td>{row.status_code ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <footer className="admin-audit__pager">
        <button
          type="button"
          className="sn-btn sn-btn-ghost"
          disabled={page <= 1}
          onClick={() => setFilters((prev) => ({ ...prev, offset: Math.max(0, (prev.offset ?? 0) - (prev.limit ?? 50)) }))}
        >
          Precedent
        </button>
        <span>Page {page} / {maxPage} - {total} evenement(s)</span>
        <button
          type="button"
          className="sn-btn sn-btn-ghost"
          disabled={page >= maxPage}
          onClick={() => setFilters((prev) => ({ ...prev, offset: (prev.offset ?? 0) + (prev.limit ?? 50) }))}
        >
          Suivant
        </button>
      </footer>
    </div>
  );
}
