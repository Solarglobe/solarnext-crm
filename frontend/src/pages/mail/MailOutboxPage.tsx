import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./mail-inbox.css";
import {
  ActionBar,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from "../../components/ui";
import {
  cancelMailOutbox,
  getMailOutboxList,
  retryMailOutbox,
  type MailOutboxListItem,
} from "../../services/mailApi";

const PAGE = 40;

function statusLabel(s: string): string {
  const x = s.toLowerCase();
  if (x === "queued") return "En attente";
  if (x === "sending") return "Envoi en cours";
  if (x === "retrying") return "Relance prevue";
  if (x === "sent") return "Envoye";
  if (x === "failed") return "Echec";
  if (x === "cancelled") return "Annule";
  return s;
}

function mailOutboxStatusBadgeClass(status: string): string {
  const x = status.toLowerCase();
  if (x === "failed") return "sn-badge-danger";
  if (x === "sent") return "sn-badge-success";
  if (x === "queued" || x === "retrying") return "sn-badge-warn";
  if (x === "sending") return "sn-badge-info";
  if (x === "cancelled") return "sn-badge-neutral";
  return "sn-badge-neutral";
}

function formatWhen(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "-";
  }
}

export default function MailOutboxPage() {
  const [filter, setFilter] = useState<string>("");
  const [items, setItems] = useState<MailOutboxListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await getMailOutboxList({
        status: filter || null,
        limit: PAGE,
        offset: 0,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRetry(id: string) {
    setBusyId(id);
    try {
      await retryMailOutbox(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onCancel(id: string) {
    setBusyId(id);
    try {
      await cancelMailOutbox(id);
      setCancelConfirmId(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const columns = useMemo<DataTableColumn<MailOutboxListItem>[]>(
    () => [
      {
        id: "status",
        header: "Statut",
        render: (row) => <span className={`sn-badge ${mailOutboxStatusBadgeClass(row.status)}`}>{statusLabel(row.status)}</span>,
      },
      { id: "subject", header: "Sujet", render: (row) => <span className="mail-outbox-subj">{row.subject || "(sans objet)"}</span> },
      { id: "account", header: "Compte", render: (row) => row.accountEmail || "-" },
      { id: "attempts", header: "Tentatives", render: (row) => `${row.attemptCount}/${row.maxAttempts}` },
      { id: "next", header: "Prochain essai", render: (row) => formatWhen(row.nextAttemptAt) },
      {
        id: "error",
        header: "Derniere erreur",
        render: (row) => (
          <span className="mail-outbox-err" title={row.lastError || ""}>
            {row.lastError ? String(row.lastError).slice(0, 80) + (row.lastError.length > 80 ? "..." : "") : "-"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        render: (row) => (
          <div className="mail-outbox-actions">
            {row.threadId ? (
              <Link to="/mail" className="sn-btn sn-btn-ghost sn-btn-sm" title="Ouvrir la boite mail pour retrouver le fil">
                Mail
              </Link>
            ) : null}
            {row.status === "failed" ? (
              <Button type="button" variant="secondary" size="sm" disabled={busyId === row.id} onClick={() => void onRetry(row.id)}>
                Reessayer
              </Button>
            ) : null}
            {row.status !== "sent" && row.status !== "cancelled" && row.status !== "failed" && row.status !== "sending" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyId === row.id}
                onClick={() => setCancelConfirmId(row.id)}
              >
                Annuler
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [busyId, load]
  );

  return (
    <div className="mail-outbox-page">
      <PageHeader
        eyebrow="Mail"
        title="Envois"
        description="File d'attente, retries SMTP et envois recents."
        actions={<Link to="/mail" className="sn-btn sn-btn-ghost sn-btn-sm">Boite de reception</Link>}
        meta={<span className="sn-badge sn-badge-neutral">{total} elements</span>}
      />

      <ActionBar
        className="mail-standard-filters"
        primary={
          <label className="mail-standard-field">
            <span>Statut</span>
            <select className="sn-input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer par statut">
              <option value="">Tous ({total})</option>
              <option value="queued">En attente</option>
              <option value="sending">Envoi en cours</option>
              <option value="retrying">Relance prevue</option>
              <option value="failed">Echec</option>
              <option value="sent">Envoyes recents</option>
              <option value="cancelled">Annules</option>
            </select>
          </label>
        }
        secondary={<Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>Actualiser</Button>}
      />

      {err ? <p className="mail-inbox__error" role="alert">{err}</p> : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          title={filter ? "Aucun envoi pour ce statut" : "Aucun envoi en file"}
          description="Les emails envoyes ou en attente apparaitront ici avec leur statut SMTP."
        />
      ) : (
        <DataTable
          dense
          loading={loading}
          columns={columns}
          rows={items}
          getRowKey={(row) => row.id}
          emptyTitle="Aucun envoi"
          emptyDescription="Changez le statut ou actualisez la file d'attente."
          className="mail-standard-table"
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelConfirmId)}
        title="Annuler cet envoi ?"
        description="L'email sera retire de la file d'attente. Les emails deja envoyes ne sont pas modifies."
        confirmLabel={busyId ? "Annulation..." : "Annuler l'envoi"}
        cancelLabel="Fermer"
        variant="warning"
        loading={Boolean(busyId)}
        onCancel={() => {
          if (!busyId) setCancelConfirmId(null);
        }}
        onConfirm={() => {
          if (cancelConfirmId) void onCancel(cancelConfirmId);
        }}
      />
    </div>
  );
}
