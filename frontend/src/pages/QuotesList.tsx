/**
 * Liste des devis — filtres, colonnes métier, actions (sans modifier l’API).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import {
  deleteQuote,
  duplicateQuote,
  fetchQuotesList,
  postGenerateQuotePdf,
  type QuoteListRow,
} from "../services/financial.api";
import { formatQuoteNumberDisplay } from "../modules/finance/documentDisplay";
import { canOfferOfficialQuotePdfFromListRow } from "../modules/quotes/quoteWorkflow";
import { QuoteStatusBadge } from "../modules/leads/LeadDetail/financial/financialStatusBadges";
import "../modules/quotes/quote-builder.css";
import "../modules/leads/LeadDetail/financial/financial-tab.css";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €" : "—";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("fr-FR", { dateStyle: "short" });
  } catch {
    return "—";
  }
}

function rowDateMs(r: QuoteListRow): number {
  const raw = r.updated_at || r.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatQuoteContact(row: QuoteListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_full_name?.trim()) return row.lead_full_name.trim();
  if (row.lead_id) return "Lead (dossier)";
  return "—";
}

type QuoteStatusFilter = "ALL" | "DRAFT" | "SENT" | "ACCEPTED" | "REFUSED";
type PeriodFilter = "ALL" | "TODAY" | "7D" | "30D";
type QuoteDateRangeBasis = "CREATED" | "UPDATED" | "EITHER";

function normStatus(s: string | undefined) {
  return String(s || "")
    .trim()
    .toUpperCase();
}

function matchesQuoteStatusFilter(row: QuoteListRow, f: QuoteStatusFilter): boolean {
  if (f === "ALL") return true;
  const st = normStatus(row.status);
  if (f === "DRAFT") return st === "DRAFT";
  if (f === "SENT") return st === "SENT" || st === "READY_TO_SEND";
  if (f === "ACCEPTED") return st === "ACCEPTED";
  if (f === "REFUSED") return st === "REJECTED";
  return true;
}

function isQuoteDeletable(status: string | undefined): boolean {
  return normStatus(status) === "DRAFT";
}

function matchesPeriod(row: QuoteListRow, f: PeriodFilter): boolean {
  if (f === "ALL") return true;
  const ms = rowDateMs(row);
  if (!ms) return true;
  const now = new Date();
  const startToday = startOfLocalDay(now);
  if (f === "TODAY") return ms >= startToday;
  const day = 86400000;
  if (f === "7D") return ms >= Date.now() - 7 * day;
  if (f === "30D") return ms >= Date.now() - 30 * day;
  return true;
}

function parseIsoToMs(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

function localYmdStartMs(ymd: string): number | null {
  const t = ymd.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const ms = new Date(y, mo, d).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function matchesQuoteDateRange(row: QuoteListRow, fromYmd: string, toYmd: string, basis: QuoteDateRangeBasis): boolean {
  const hasFrom = Boolean(fromYmd.trim());
  const hasTo = Boolean(toYmd.trim());
  if (!hasFrom && !hasTo) return true;

  const a = hasFrom ? localYmdStartMs(fromYmd) : null;
  const b = hasTo ? localYmdStartMs(toYmd) : null;
  if (hasFrom && a == null) return true;
  if (hasTo && b == null) return true;

  let low: number;
  let highExclusive: number;
  if (a != null && b != null) {
    low = Math.min(a, b);
    highExclusive = Math.max(a, b) + 86400000;
  } else if (a != null) {
    low = a;
    highExclusive = Infinity;
  } else {
    low = -Infinity;
    highExclusive = b! + 86400000;
  }

  const inRange = (ts: number) => ts >= low && ts < highExclusive;

  if (basis === "CREATED") {
    const ts = parseIsoToMs(row.created_at);
    return ts != null && inRange(ts);
  }
  if (basis === "UPDATED") {
    const ts = parseIsoToMs(row.updated_at ?? row.created_at);
    return ts != null && inRange(ts);
  }
  const c = parseIsoToMs(row.created_at);
  const u = parseIsoToMs(row.updated_at);
  if (c != null && inRange(c)) return true;
  if (u != null && inRange(u)) return true;
  return false;
}

const PDF_OFFICIAL_HINT =
  "Un PDF peut être généré une fois le document figé (« Envoyé » ou validation signée depuis « Présenter »). Le numéro officiel n’apparaît qu’après signature du devis.";

function PdfGlyph({ hasPdf, hasSignedPdf = false }: { hasPdf: boolean; hasSignedPdf?: boolean }) {
  const ok = hasPdf || hasSignedPdf;
  return (
    <span
      className="fin-saas-pdf-ic"
      title={ok ? "PDF disponible" : "Pas de PDF enregistré"}
      aria-label={ok ? "PDF disponible" : "Pas de PDF"}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15h6" />
        <path d="M9 11h6" />
      </svg>
      <span className={`fin-saas-pdf-dot ${ok ? "fin-saas-pdf-dot--ok" : "fin-saas-pdf-dot--off"}`} />
    </span>
  );
}

export default function QuotesList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<QuoteListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QuoteStatusFilter>("ALL");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateRangeBasis, setDateRangeBasis] = useState<QuoteDateRangeBasis>("EITHER");
  const [search, setSearch] = useState("");
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [dupBusyId, setDupBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchQuotesList({ limit: 500 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const raw = searchParams.get("status");
    if (!raw) return;
    const u = raw.trim().toUpperCase();
    const map: Record<string, QuoteStatusFilter> = {
      ALL: "ALL",
      DRAFT: "DRAFT",
      SENT: "SENT",
      ACCEPTED: "ACCEPTED",
      REFUSED: "REFUSED",
      REJECTED: "REFUSED",
    };
    if (map[u]) setStatusFilter(map[u]);
  }, [searchParams]);

  const useCustomDateRange = Boolean(dateFrom.trim() || dateTo.trim());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const custom = Boolean(dateFrom.trim() || dateTo.trim());
    return rows
      .filter((r) => matchesQuoteStatusFilter(r, statusFilter))
      .filter((r) => (custom ? matchesQuoteDateRange(r, dateFrom, dateTo, dateRangeBasis) : matchesPeriod(r, periodFilter)))
      .filter((r) => {
        if (!q) return true;
        const num = String(r.quote_number || "").toLowerCase();
        const contact = formatQuoteContact(r).toLowerCase();
        const id = String(r.id || "").toLowerCase();
        return num.includes(q) || contact.includes(q) || id.includes(q);
      })
      .sort((a, b) => rowDateMs(b) - rowDateMs(a));
  }, [rows, statusFilter, periodFilter, dateFrom, dateTo, dateRangeBasis, search]);

  const onGeneratePdf = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPdfBusyId(id);
    try {
      await postGenerateQuotePdf(id);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erreur PDF");
    } finally {
      setPdfBusyId(null);
    }
  };

  const onDuplicate = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDupBusyId(id);
    try {
      const res = await duplicateQuote(id);
      const newId = res?.quote?.id;
      if (newId) navigate(`/quotes/${newId}`);
      else await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erreur duplication");
    } finally {
      setDupBusyId(null);
    }
  };

  const onDeleteQuote = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Supprimer définitivement ce devis brouillon ? Cette action est irréversible.")) return;
    setDeleteBusyId(id);
    try {
      await deleteQuote(id);
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erreur suppression");
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div className="qb-page fin-pole-shell">
      <div className="fin-pole-list-hero">
        <div className="fin-pole-list-hero__text">
          <h1 className="sg-title">Devis</h1>
          <p className="fin-pole-lead">
            Filtrez, exportez en PDF ou dupliquez un devis. Nouveau devis : ouvrez un lead → onglet Financier.
          </p>
        </div>
        <div className="fin-pole-list-hero__actions">
          <Link to="/finance" className="sn-btn sn-btn-ghost sn-btn-sm">
            Vue d&apos;ensemble
          </Link>
          <Link to="/invoices" className="sn-btn sn-btn-ghost sn-btn-sm">
            Factures
          </Link>
          <Link to="/leads" className="sn-btn sn-btn-outline-gold sn-btn-sm">
            Leads
          </Link>
          <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
            Actualiser
          </Button>
        </div>
      </div>

      <div className="fin-saas-filters" style={{ marginBottom: 16 }}>
        <label className="fin-saas-filter-field">
          <span className="fin-saas-filter-label">Statut</span>
          <select className="sn-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QuoteStatusFilter)}>
            <option value="ALL">Tous</option>
            <option value="DRAFT">Brouillon</option>
            <option value="SENT">Envoyé / prêt</option>
            <option value="ACCEPTED">Accepté</option>
            <option value="REFUSED">Refusé</option>
          </select>
        </label>
        <label className="fin-saas-filter-field" title={useCustomDateRange ? "Désactivé tant qu’un intervalle Du/Au est renseigné" : undefined}>
          <span className="fin-saas-filter-label">Période rapide</span>
          <select
            className="sn-input"
            value={periodFilter}
            disabled={useCustomDateRange}
            onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
          >
            <option value="ALL">Toutes</option>
            <option value="TODAY">Aujourd&apos;hui</option>
            <option value="7D">7 jours</option>
            <option value="30D">30 jours</option>
          </select>
        </label>
        <label className="fin-saas-filter-field fin-saas-filter-field--date">
          <span className="fin-saas-filter-label">Du</span>
          <input
            type="date"
            className="sn-input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Date de début (filtre)"
          />
        </label>
        <label className="fin-saas-filter-field fin-saas-filter-field--date">
          <span className="fin-saas-filter-label">Au</span>
          <input
            type="date"
            className="sn-input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Date de fin (filtre)"
          />
        </label>
        <label className="fin-saas-filter-field fin-saas-filter-field--basis">
          <span className="fin-saas-filter-label">Filtrer sur</span>
          <select
            className="sn-input"
            value={dateRangeBasis}
            onChange={(e) => setDateRangeBasis(e.target.value as QuoteDateRangeBasis)}
            aria-label="Critère de dates"
          >
            <option value="EITHER">Création ou dernière modification</option>
            <option value="CREATED">Date de création</option>
            <option value="UPDATED">Dernière modification</option>
          </select>
        </label>
        <label className="fin-saas-filter-field fin-saas-filter-field--grow">
          <span className="fin-saas-filter-label">Recherche</span>
          <input
            className="sn-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° devis, client, contact…"
            aria-label="Recherche devis"
          />
        </label>
      </div>

      {error ? <p className="qb-error-inline">{error}</p> : null}
      {loading ? <p className="qb-muted">Chargement des devis…</p> : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="crm-lead-card" style={{ padding: 24, maxWidth: 560 }}>
          <p className="fin-empty-title" style={{ marginTop: 0 }}>
            Aucun devis pour l&apos;instant
          </p>
          <p className="fin-empty-desc" style={{ marginBottom: 16 }}>
            Créez un devis depuis un lead : dossier → onglet Financier → « Créer un devis ».
          </p>
          <Link to="/leads" className="sn-btn sn-btn-primary" style={{ textDecoration: "none" }}>
            Aller aux leads
          </Link>
        </div>
      ) : null}

      {!loading && rows.length > 0 && filtered.length === 0 ? (
        <p className="qb-muted">Aucun devis ne correspond aux filtres.</p>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="qb-table-wrap">
          <table className="qb-table">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th className="qb-num">Montant TTC</th>
                <th>Statut</th>
                <th>Date</th>
                <th>PDF</th>
                <th className="fin-table-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="qb-mono">{formatQuoteNumberDisplay(r.quote_number, r.status)}</td>
                  <td>{formatQuoteContact(r)}</td>
                  <td className="qb-num">{eur(r.total_ttc)}</td>
                  <td>
                    <QuoteStatusBadge status={r.status} />
                  </td>
                  <td>{fmtDate(r.updated_at || r.created_at)}</td>
                  <td>
                    <PdfGlyph hasPdf={Boolean(r.has_pdf)} hasSignedPdf={Boolean(r.has_signed_pdf)} />
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <button
                        type="button"
                        className="fin-link-btn fin-link-btn--accent"
                        onClick={() => navigate(`/quotes/${r.id}`)}
                      >
                        Ouvrir
                      </button>
                      <button
                        type="button"
                        className="fin-link-btn"
                        onClick={() => navigate(`/quotes/${r.id}/present`)}
                      >
                        Présenter
                      </button>
                      {canOfferOfficialQuotePdfFromListRow(r) ? (
                        <button
                          type="button"
                          className="fin-link-btn"
                          disabled={pdfBusyId === r.id}
                          onClick={(e) => void onGeneratePdf(e, r.id)}
                        >
                          {pdfBusyId === r.id ? "PDF…" : "Générer PDF"}
                        </button>
                      ) : (
                        <button type="button" className="fin-link-btn" disabled title={PDF_OFFICIAL_HINT}>
                          PDF
                        </button>
                      )}
                      <button
                        type="button"
                        className="fin-link-btn"
                        disabled={dupBusyId === r.id}
                        onClick={(e) => void onDuplicate(e, r.id)}
                      >
                        {dupBusyId === r.id ? "…" : "Dupliquer"}
                      </button>
                      {isQuoteDeletable(r.status) ? (
                        <button
                          type="button"
                          className="fin-quote-list-delete"
                          title="Supprimer le devis"
                          aria-label="Supprimer le devis"
                          disabled={deleteBusyId === r.id}
                          onClick={(e) => void onDeleteQuote(e, r.id)}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden>
                            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <style>{`
        .fin-saas-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 12px 16px;
          align-items: flex-end;
        }
        .fin-saas-filter-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 140px;
        }
        .fin-saas-filter-field--grow {
          flex: 1 1 220px;
          min-width: 200px;
        }
        .fin-saas-filter-field--date {
          min-width: 148px;
          max-width: 168px;
        }
        .fin-saas-filter-field--basis {
          min-width: 200px;
          flex: 1 1 200px;
          max-width: 320px;
        }
        .fin-saas-filter-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
        }
        .fin-saas-pdf-ic {
          position: relative;
          display: inline-flex;
          color: var(--text-muted);
          vertical-align: middle;
        }
        .fin-saas-pdf-dot {
          position: absolute;
          right: -2px;
          bottom: -2px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: 2px solid var(--surface-elevated, #1e1a28);
        }
        .theme-light .fin-saas-pdf-dot {
          border-color: #fff;
        }
        .fin-saas-pdf-dot--ok {
          background: var(--sg-success, #16a34a);
        }
        .fin-saas-pdf-dot--off {
          background: color-mix(in srgb, var(--text-muted) 45%, transparent);
        }
        .fin-quote-list-delete {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          margin-left: 2px;
          padding: 0;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: #dc2626;
          cursor: pointer;
          vertical-align: middle;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .fin-quote-list-delete:hover:not(:disabled) {
          background: rgba(220, 38, 38, 0.14);
          color: #b91c1c;
        }
        .fin-quote-list-delete:focus-visible {
          outline: 2px solid rgba(220, 38, 38, 0.45);
          outline-offset: 2px;
        }
        .fin-quote-list-delete:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
