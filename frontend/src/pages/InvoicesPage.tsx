/**
 * Liste factures — filtres métier, colonnes encours, création depuis devis (recherche, pas d’UUID).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { ModalShell } from "../components/ui/ModalShell";
import {
  fetchInvoicesList,
  fetchQuotesList,
  type InvoiceListRow,
  type QuoteListRow,
} from "../services/financial.api";
import { quoteDisplayTotals } from "../services/quotes.service";
import { formatInvoiceNumberDisplay } from "../modules/finance/documentDisplay";
import { InvoiceStatusBadge } from "../modules/leads/LeadDetail/financial/financialStatusBadges";
import "../modules/quotes/quote-builder.css";
import "../modules/invoices/invoice-builder.css";
import "../modules/leads/LeadDetail/financial/financial-tab.css";
import "../modules/finance/financial-list-saas.css";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("fr-FR", { dateStyle: "short" });
  } catch {
    return "—";
  }
}

function toAmount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isInvoiceOverdue(inv: InvoiceListRow): boolean {
  const st = String(inv.status).toUpperCase();
  if (["PAID", "CANCELLED", "DRAFT"].includes(st)) return false;
  const ad = toAmount(inv.amount_due);
  if (ad <= 0 || !inv.due_date) return false;
  return String(inv.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function formatInvoiceClient(row: InvoiceListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_id) return "Lead (sans fiche client)";
  return "—";
}

function invoiceRowDateMs(r: InvoiceListRow): number {
  const raw = r.issue_date || r.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

type InvStatusFilter = "ALL" | "DRAFT" | "ISSUED" | "PAID" | "PARTIAL" | "OVERDUE";
type InvPeriodFilter = "ALL" | "WEEK" | "MONTH" | "YEAR";
/** Critère du filtre date à date (création / édition) */
type InvDateRangeBasis = "CREATED" | "UPDATED" | "EITHER";

function norm(s: string | undefined) {
  return String(s || "")
    .trim()
    .toUpperCase();
}

function invoiceRowIsTest(r: InvoiceListRow): boolean {
  const raw = r.metadata_json;
  if (raw == null) return false;
  if (typeof raw === "object" && raw !== null && "is_test" in raw) {
    return (raw as { is_test?: unknown }).is_test === true;
  }
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as { is_test?: unknown };
      return p?.is_test === true;
    } catch {
      return false;
    }
  }
  return false;
}

function matchesInvoiceStatus(row: InvoiceListRow, f: InvStatusFilter): boolean {
  if (f === "ALL") return true;
  const st = norm(row.status);
  if (f === "OVERDUE") return isInvoiceOverdue(row);
  if (f === "PARTIAL") return st === "PARTIALLY_PAID";
  return st === f;
}

function matchesInvoicePeriod(row: InvoiceListRow, f: InvPeriodFilter): boolean {
  if (f === "ALL") return true;
  const ms = invoiceRowDateMs(row);
  if (!ms) return true;
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const t0 = startOfDay(now);
  if (f === "WEEK") return ms >= t0 - 6 * 86400000;
  if (f === "MONTH") return ms >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (f === "YEAR") return ms >= new Date(now.getFullYear(), 0, 1).getTime();
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

/** Filtre inclusif sur journées locales ; si les deux bornes sont renseignées dans le désordre, l’intervalle est normalisé. */
function matchesInvoiceDateRange(
  row: InvoiceListRow,
  fromYmd: string,
  toYmd: string,
  basis: InvDateRangeBasis
): boolean {
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

function IconSearchFin({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function formatQuoteLine(q: QuoteListRow): string {
  const num = q.quote_number || q.id.slice(0, 8);
  const contact =
    q.company_name?.trim() ||
    [q.first_name, q.last_name].filter(Boolean).join(" ").trim() ||
    q.lead_full_name?.trim() ||
    "—";
  return `${num} — ${contact}`;
}

function quoteRowCanInvoice(q: QuoteListRow): boolean {
  const hasClient = Boolean(q.client_id && String(q.client_id).trim());
  const hasLead = Boolean(q.lead_id && String(q.lead_id).trim());
  return hasClient || hasLead;
}

function quoteRowInvoiceBlockedReason(q: QuoteListRow): string {
  return "Ce devis accepté n’a ni fiche client ni dossier (lead) : facturation impossible. Corrigez le rattachement du devis.";
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvStatusFilter>("ALL");
  const [periodFilter, setPeriodFilter] = useState<InvPeriodFilter>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateRangeBasis, setDateRangeBasis] = useState<InvDateRangeBasis>("EITHER");
  const [search, setSearch] = useState("");
  const [quoteModal, setQuoteModal] = useState(false);
  const [quotesForPicker, setQuotesForPicker] = useState<QuoteListRow[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<QuoteListRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [quoteModalError, setQuoteModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchInvoicesList({ limit: 500 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!quoteModal) return;
    setQuoteModalError(null);
    let cancelled = false;
    setQuotesLoading(true);
    void fetchQuotesList({ limit: 500 })
      .then((list) => {
        if (!cancelled) {
          const accepted = list.filter((q) => norm(q.status) === "ACCEPTED");
          setQuotesForPicker(accepted);
        }
      })
      .catch(() => {
        if (!cancelled) setQuotesForPicker([]);
      })
      .finally(() => {
        if (!cancelled) setQuotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quoteModal]);

  useEffect(() => {
    if (!quoteModal) {
      setQuoteSearch("");
      setSelectedQuote(null);
      setQuoteModalError(null);
    }
  }, [quoteModal]);

  const useCustomDateRange = Boolean(dateFrom.trim() || dateTo.trim());

  const handleResetFilters = useCallback(() => {
    setStatusFilter("ALL");
    setPeriodFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setDateRangeBasis("EITHER");
    setSearch("");
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const custom = Boolean(dateFrom.trim() || dateTo.trim());
    return rows
      .filter((r) => matchesInvoiceStatus(r, statusFilter))
      .filter((r) =>
        custom ? matchesInvoiceDateRange(r, dateFrom, dateTo, dateRangeBasis) : matchesInvoicePeriod(r, periodFilter)
      )
      .filter((r) => {
        if (!q) return true;
        const num = String(r.invoice_number || "").toLowerCase();
        const contact = formatInvoiceClient(r).toLowerCase();
        const id = String(r.id || "").toLowerCase();
        return num.includes(q) || contact.includes(q) || id.includes(q);
      })
      .sort((a, b) => {
        const oa = isInvoiceOverdue(a) ? 0 : 1;
        const ob = isInvoiceOverdue(b) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        if (oa === 0) {
          const da = String(a.due_date || "").slice(0, 10);
          const db = String(b.due_date || "").slice(0, 10);
          return da.localeCompare(db);
        }
        return invoiceRowDateMs(b) - invoiceRowDateMs(a);
      });
  }, [rows, statusFilter, periodFilter, dateFrom, dateTo, dateRangeBasis, search]);

  const quotePickerOptions = useMemo(() => {
    const q = quoteSearch.trim().toLowerCase();
    let list = quotesForPicker;
    if (q) {
      list = list.filter((row) => {
        const num = String(row.quote_number || "").toLowerCase();
        const contact = formatQuoteLine(row).toLowerCase();
        return num.includes(q) || contact.includes(q) || String(row.id).toLowerCase().includes(q);
      });
    }
    return list.slice(0, 40);
  }, [quotesForPicker, quoteSearch]);

  const createFromSelectedQuote = async () => {
    if (!selectedQuote) return;
    if (!quoteRowCanInvoice(selectedQuote)) {
      setQuoteModalError(quoteRowInvoiceBlockedReason(selectedQuote));
      return;
    }
    setQuoteModalError(null);
    setQuoteModal(false);
    navigate(
      `/invoices/new?fromQuote=${encodeURIComponent(selectedQuote.id)}&billingRole=STANDARD`
    );
  };

  return (
    <div className="qb-page fin-pole-shell">
      <div className="fin-pole-list-hero">
        <div className="fin-pole-list-hero__text">
          <h1 className="sg-title">Factures</h1>
          <p className="fin-pole-lead">
            Encaissements et relances. Acomptes et soldes depuis un devis accepté ; le bouton ci-contre duplique les lignes d&apos;un
            devis accepté en facture complète.
          </p>
        </div>
        <div className="fin-pole-list-hero__actions">
          <Link to="/finance" className="sn-btn sn-btn-ghost sn-btn-sm">
            Vue d&apos;ensemble
          </Link>
          <Link to="/quotes" className="sn-btn sn-btn-ghost sn-btn-sm">
            Devis
          </Link>
          <Button type="button" variant="primary" size="sm" onClick={() => setQuoteModal(true)}>
            Créer depuis devis
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/invoices/new")} title="Facture vierge — préférez un devis accepté pour préremplir.">
            Nouvelle facture
          </Button>
        </div>
      </div>

      <div className="sn-leads-toolbar-wrap">
        <div className="sn-leads-filters-card" role="search" aria-label="Filtres factures">
          <div className="sn-leads-filters-primary">
            <div className="sn-leads-filters-search">
              <IconSearchFin className="sn-leads-filters-search__icon" />
              <input
                id="fin-invoices-search"
                type="search"
                className="sn-leads-filters-search__input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher n°, client, contact…"
                aria-label="Rechercher une facture"
                autoComplete="off"
              />
            </div>
            <div className="sn-leads-filters-field">
              <label htmlFor="fin-inv-status" className="sn-leads-filters-field__label">
                Statut
              </label>
              <select
                id="fin-inv-status"
                className="sn-leads-filters-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as InvStatusFilter)}
              >
                <option value="ALL">Tous</option>
                <option value="DRAFT">Brouillon</option>
                <option value="ISSUED">Émise</option>
                <option value="PARTIAL">Partiellement payée</option>
                <option value="PAID">Payée</option>
                <option value="OVERDUE">En retard</option>
              </select>
            </div>
            <div className="sn-leads-filters-field sn-leads-filters-field--daterange">
              <span className="sn-leads-filters-field__label">Plage de dates</span>
              <div className="sn-leads-filters-daterange">
                <input
                  type="date"
                  className="sn-leads-filters-input sn-leads-filters-input--date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="Date de début (filtre)"
                />
                <span className="sn-leads-filters-daterange__sep" aria-hidden>
                  –
                </span>
                <input
                  type="date"
                  className="sn-leads-filters-input sn-leads-filters-input--date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="Date de fin (filtre)"
                />
              </div>
            </div>
            <div className="sn-leads-filters-primary__reset">
              <button type="button" className="sn-leads-filters-reset" onClick={handleResetFilters}>
                Réinitialiser
              </button>
            </div>
          </div>
          <div className="sn-leads-filters-secondary" aria-label="Filtres dates">
            <div
              className="sn-leads-filters-field sn-leads-filters-field--subtle"
              title={useCustomDateRange ? "Désactivé tant qu’une plage Du/Au est renseignée" : undefined}
            >
              <label htmlFor="fin-inv-period" className="sn-leads-filters-field__label">
                Période rapide
              </label>
              <select
                id="fin-inv-period"
                className="sn-leads-filters-select sn-leads-filters-select--subtle"
                value={periodFilter}
                disabled={useCustomDateRange}
                onChange={(e) => setPeriodFilter(e.target.value as InvPeriodFilter)}
              >
                <option value="ALL">Toutes</option>
                <option value="WEEK">Semaine glissante</option>
                <option value="MONTH">Mois en cours</option>
                <option value="YEAR">Année en cours</option>
              </select>
            </div>
            <div className="sn-leads-filters-field sn-leads-filters-field--subtle fin-list-field--wide">
              <label htmlFor="fin-inv-basis" className="sn-leads-filters-field__label">
                Filtrer sur
              </label>
              <select
                id="fin-inv-basis"
                className="sn-leads-filters-select sn-leads-filters-select--subtle"
                value={dateRangeBasis}
                onChange={(e) => setDateRangeBasis(e.target.value as InvDateRangeBasis)}
                aria-label="Critère de dates"
              >
                <option value="EITHER">Création ou dernière modification</option>
                <option value="CREATED">Date de création</option>
                <option value="UPDATED">Dernière modification</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="qb-error-inline">{error}</p> : null}
      {loading ? <p className="qb-muted">Chargement…</p> : null}

      {!loading && rows.length > 0 && filtered.length === 0 ? (
        <p className="qb-muted">Aucune facture ne correspond aux filtres.</p>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="qb-table-wrap qb-table-wrap--list-saas">
          <table className="sn-ui-table qb-table qb-table--list-saas">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th className="qb-num">Montant TTC</th>
                <th className="qb-num">Payé</th>
                <th className="qb-num">Reste à encaisser</th>
                <th>Statut</th>
                <th>Échéance</th>
                <th>Retard</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const overdue = isInvoiceOverdue(r);
                const paid = toAmount(r.total_paid);
                const due = toAmount(r.amount_due);
                const partial = norm(r.status) === "PARTIALLY_PAID" && due > 0;
                return (
                  <tr
                    key={r.id}
                    className={`qb-line${overdue ? " fin-saas-row-overdue" : ""}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/invoices/${r.id}`)}
                  >
                    <td className="qb-mono">
                      <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        {formatInvoiceNumberDisplay(r.invoice_number, r.status)}
                        {invoiceRowIsTest(r) ? (
                          <span className="sn-badge sn-badge-warn" title="Facture test">
                            TEST
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>{formatInvoiceClient(r)}</td>
                    <td className="qb-num">{eur(r.total_ttc)}</td>
                    <td className="qb-num">{eur(r.total_paid)}</td>
                    <td className="qb-num">{eur(r.amount_due)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <InvoiceStatusBadge status={r.status} />
                    </td>
                    <td>{fmtDate(r.due_date)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {overdue ? (
                        <span className="sn-badge sn-badge-danger" title="Échéance dépassée et solde dû">
                          Retard
                        </span>
                      ) : paid > 0 && due <= 0 ? (
                        <span className="sn-badge sn-badge-success">Soldée</span>
                      ) : partial ? (
                        <span className="sn-badge sn-badge-warn">Partiel</span>
                      ) : (
                        <span className="sn-badge sn-badge-neutral">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && rows.length === 0 ? <p className="qb-muted">Aucune facture pour l&apos;instant.</p> : null}

      <ModalShell
        open={quoteModal}
        onClose={() => setQuoteModal(false)}
        title="Créer depuis un devis"
        subtitle="Seuls les devis acceptés sont proposés. Si le devis n’a pas encore de fiche client mais un dossier (lead) est rattaché, un client sera créé ou rattaché automatiquement à la création de la facture. Pour acompte ou solde, ouvrez le devis et utilisez les liens Facturation."
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setQuoteModal(false)}>
              Fermer
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                creating ||
                !selectedQuote ||
                !quoteRowCanInvoice(selectedQuote)
              }
              onClick={() => void createFromSelectedQuote()}
            >
              {creating ? "Création…" : "Créer la facture"}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="ib-label" style={{ width: "100%" }}>
            Rechercher un devis
            <input
              className="sn-input ib-input-full"
              value={quoteSearch}
              onChange={(e) => setQuoteSearch(e.target.value)}
              placeholder="Numéro ou nom client…"
              autoComplete="off"
            />
          </label>
          {quotesLoading ? <p className="qb-muted">Chargement des devis acceptés…</p> : null}
          {quoteModalError ? (
            <p className="qb-error-inline" role="alert">
              {quoteModalError}
            </p>
          ) : null}
          {!quotesLoading && quotesForPicker.length === 0 ? (
            <p className="qb-muted">Aucun devis accepté trouvé.</p>
          ) : null}
          {!quotesLoading && quotePickerOptions.length > 0 ? (
            <div className="fin-saas-quote-ac" role="listbox" aria-label="Sélection de devis">
              {quotePickerOptions.map((q) => {
                const sel = selectedQuote?.id === q.id;
                const blocked = !quoteRowCanInvoice(q);
                const reason = quoteRowInvoiceBlockedReason(q);
                return (
                  <button
                    key={q.id}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    disabled={blocked}
                    title={blocked ? reason : undefined}
                    className={`fin-saas-quote-ac-row${sel ? " fin-saas-quote-ac-row--sel" : ""}${blocked ? " fin-saas-quote-ac-row--disabled" : ""}`}
                    onClick={() => {
                      if (blocked) {
                        setQuoteModalError(reason);
                        return;
                      }
                      setQuoteModalError(null);
                      setSelectedQuote(q);
                    }}
                  >
                    <span className="qb-mono" style={{ fontSize: 13 }}>
                      {q.quote_number || q.id.slice(0, 8)}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{formatQuoteContact(q)}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12 }}>{eur(quoteDisplayTotals(q).total_ttc)}</span>
                    {blocked ? (
                      <span className="fin-saas-quote-ac-row__hint" style={{ flexBasis: "100%", fontSize: 11 }}>
                        {reason}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          {!quotesLoading && quotesForPicker.length > 0 && quotePickerOptions.length === 0 ? (
            <p className="qb-muted">Aucun résultat pour cette recherche.</p>
          ) : null}
        </div>
      </ModalShell>

    </div>
  );
}

function formatQuoteContact(row: QuoteListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_full_name?.trim()) return row.lead_full_name.trim();
  return "—";
}
