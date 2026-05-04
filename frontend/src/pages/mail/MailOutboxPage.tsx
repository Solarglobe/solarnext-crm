import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./mail-inbox.css";
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
  if (x === "retrying") return "Relance prévue";
  if (x === "sent") return "Envoyé";
  if (x === "failed") return "Échec";
  if (x === "cancelled") return "Annulé";
  return s;
}

/** Variantes design system : queued/retrying → warn, sent → success, failed → danger, cancelled → neutral, sending → info */
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
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export default function MailOutboxPage() {
  const [filter, setFilter] = useState<string>("");
  const [items, setItems] = useState<MailOutboxListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    if (!window.confirm("Annuler cet envoi ?")) return;
    setBusyId(id);
    try {
      await cancelMailOutbox(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mail-inbox mail-inbox--outbox">
      <header className="mail-inbox__toolbar">
        <div className="mail-inbox__toolbar-left">
          <h1 className="mail-inbox__title">Envois</h1>
          <p className="mail-inbox__subtitle">File d’attente et statuts SMTP</p>
        </div>
        <div className="mail-inbox__toolbar-right">
          <Link to="/mail" className="sg-btn sg-btn-ghost">
            Boîte de réception
          </Link>
        </div>
      </header>

      <div className="mail-inbox__filters" style={{ marginBottom: 12 }}>
        <label className="mail-inbox__filter">
          <span>Statut</span>
          <select
            className="sg-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filtrer par statut"
          >
            <option value="">Tous ({total})</option>
            <option value="queued">En attente</option>
            <option value="sending">Envoi en cours</option>
            <option value="retrying">Relance prévue</option>
            <option value="failed">Échec</option>
            <option value="sent">Envoyés (récents)</option>
            <option value="cancelled">Annulés</option>
          </select>
        </label>
        <button type="button" className="sg-btn sg-btn-ghost" onClick={() => void load()} disabled={loading}>
          Actualiser
        </button>
      </div>

      {err && (
        <p className="mail-inbox__error" role="alert">
          {err}
        </p>
      )}

      {loading && <p className="mail-inbox__hint">Chargement…</p>}

      {!loading && items.length === 0 && <p className="mail-inbox__empty">Aucun envoi pour ce filtre.</p>}

      {!loading && items.length > 0 && (
        <div className="mail-outbox-table-wrap">
          <table className="sn-ui-table mail-outbox-table">
            <thead>
              <tr>
                <th>Statut</th>
                <th>Sujet</th>
                <th>Compte</th>
                <th>Tentatives</th>
                <th>Prochain essai</th>
                <th>Dernière erreur</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={`sn-badge ${mailOutboxStatusBadgeClass(row.status)}`}>{statusLabel(row.status)}</span>
                  </td>
                  <td className="mail-outbox-subj">{row.subject || "(sans objet)"}</td>
                  <td>{row.accountEmail || "—"}</td>
                  <td>
                    {row.attemptCount}/{row.maxAttempts}
                  </td>
                  <td>{formatWhen(row.nextAttemptAt)}</td>
                  <td className="mail-outbox-err" title={row.lastError || ""}>
                    {row.lastError ? String(row.lastError).slice(0, 80) + (row.lastError.length > 80 ? "…" : "") : "—"}
                  </td>
                  <td className="mail-outbox-actions">
                    {row.threadId && (
                      <Link to="/mail" className="sg-btn sg-btn-ghost sg-btn--sm" title="Ouvrir la boîte mail pour retrouver le fil">
                        Mail
                      </Link>
                    )}
                    {row.status === "failed" && (
                      <button
                        type="button"
                        className="sg-btn sg-btn--sm"
                        disabled={busyId === row.id}
                        onClick={() => void onRetry(row.id)}
                      >
                        Réessayer
                      </button>
                    )}
                    {row.status !== "sent" &&
                      row.status !== "cancelled" &&
                      row.status !== "failed" &&
                      row.status !== "sending" && (
                      <button
                        type="button"
                        className="sg-btn sg-btn-ghost sg-btn--sm"
                        disabled={busyId === row.id}
                        onClick={() => void onCancel(row.id)}
                      >
                        Annuler
                      </button>
                    )}
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
