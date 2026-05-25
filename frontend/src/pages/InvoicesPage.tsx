/**
 * Liste factures - surface SaaS standardisee, workflows conserves.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ActionBar,
  Button,
  DataTable,
  EmptyState,
  ModalShell,
  PageHeader,
  type DataTableColumn,
} from "../components/ui";
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
  return Number.isFinite(n)
    ? `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`
    : "-";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "-";
  try {
    return new Date(s).toLocaleDateString("fr-FR", { dateStyle: "short" });
  } catch {
    return "-";
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
  return "-";
}

function invoiceRowDateMs(r: InvoiceListRow): number {
  const raw = r.issue_date || r.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

type InvStatusFilter = "ALL" | "DRAFT" | "ISSUED" | "PAID" | "PARTIAL" | "OVERDUE";
type InvPeriodFilter = "ALL" | "WEEK" | "MONTH" | "YEAR";
type InvDateRangeBasis = "CREATED" | "UPDATED" | "EITHER";

function norm(s: string | undefined) {
  return String(s || "").trim().toUpperCase();
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
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function matchesInvoiceDateRange(row: InvoiceListRow, fromYmd: string, toYmd: string, basis: InvDateRangeBasis): boolean {
  const hasFrom = Boolean(fromYmd.trim());
  const hasTo = Boolean(toYmd.trim());
  if (!hasFrom && !hasTo) return true;

  const a = hasFrom ? localYmdStartMs(fromYmd) : null;
  const b = hasTo ? localYmdStartMs(toYmd) : null;
  if (hasFrom && a == null) return true;
  if (hasTo && b == null) return true;

  const low = a != null && b != null ? Math.min(a, b) : a ?? -Infinity;
  const highExclusive = a != null && b != null ? Math.max(a, b) + 86400000 : b != null ? b + 86400000 : Infinity;
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
  return (c != null && inRange(c)) || (u != null && inRange(u));
}

function formatQuoteContact(row: QuoteListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_full_name?.trim()) return row.lead_full_name.trim();
  return "-";
}

function formatQuoteLine(q: QuoteListRow): string {
  const num = q.quote_number || q.id.slice(0, 8);
  return `${num} - ${formatQuoteContact(q)}`;
}

function quoteRowCanInvoice(q: QuoteListRow): boolean {
  const hasClient = Boolean(q.client_id && String(q.client_id).trim());
  const hasLead = Boolean(q.lead_id && String(q.lead_id).trim());
  return hasClient || hasLead;
}

function quoteRowInvoiceBlockedReason(_q: QuoteListRow): string {
  return "Ce devis accepte n'a ni fiche client ni dossier lead : facturation impossible.";
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
  const [creating, _setCreating] = useState(false);
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
        if (!cancelled) setQuotesForPicker(list.filter((q) => norm(q.status) === "ACCEPTED"));
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
      .filter((r) => (custom ? matchesInvoiceDateRange(r, dateFrom, dateTo, dateRangeBasis) : matchesInvoicePeriod(r, periodFilter)))
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
        if (oa === 0) return String(a.due_date || "").slice(0, 10).localeCompare(String(b.due_date || "").slice(0, 10));
        return invoiceRowDateMs(b) - invoiceRowDateMs(a);
      });
  }, [rows, statusFilter, periodFilter, dateFrom, dateTo, dateRangeBasis, search]);

  const quotePickerOptions = useMemo(() => {
    const q = quoteSearch.trim().toLowerCase();
    const list = q
      ? quotesForPicker.filter((row) => {
          const num = String(row.quote_number || "").toLowerCase();
          const contact = formatQuoteLine(row).toLowerCase();
          return num.includes(q) || contact.includes(q) || String(row.id).toLowerCase().includes(q);
        })
      : quotesForPicker;
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
    navigate(`/invoices/new?fromQuote=${encodeURIComponent(selectedQuote.id)}&billingRole=STANDARD`);
  };

  const columns = useMemo<DataTableColumn<InvoiceListRow>[]>(
    () => [
      {
        id: "number",
        header: "Numero",
        width: "17%",
        render: (r) => (
          <span className="fin-row-main">
            <span className="qb-mono">{formatInvoiceNumberDisplay(r.invoice_number, r.status)}</span>
            <span className="fin-row-sub">Échéance {fmtDate(r.due_date)}</span>
            {invoiceRowIsTest(r) ? <span className="sn-badge sn-badge-warn fin-standard-inline-badge">TEST</span> : null}
          </span>
        ),
      },
      { id: "client", header: "Client", width: "21%", render: (r) => <span className="fin-standard-truncate">{formatInvoiceClient(r)}</span> },
      { id: "total", header: "TTC", align: "right", width: "12%", render: (r) => eur(r.total_ttc) },
      { id: "paid", header: "Payé", align: "right", width: "12%", render: (r) => eur(r.total_paid) },
      { id: "due", header: "Reste", align: "right", width: "12%", render: (r) => eur(r.amount_due) },
      { id: "status", header: "Statut", width: "13%", render: (r) => <InvoiceStatusBadge status={r.status} /> },
      {
        id: "late",
        header: "Suivi",
        width: "13%",
        render: (r) => {
          const overdue = isInvoiceOverdue(r);
          const paid = toAmount(r.total_paid);
          const due = toAmount(r.amount_due);
          const partial = norm(r.status) === "PARTIALLY_PAID" && due > 0;
          if (overdue) return <span className="sn-badge sn-badge-danger">Retard</span>;
          if (paid > 0 && due <= 0) return <span className="sn-badge sn-badge-success">Soldee</span>;
          if (partial) return <span className="sn-badge sn-badge-warn">Partiel</span>;
          return <span className="sn-badge sn-badge-neutral">A suivre</span>;
        },
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        width: "10%",
        render: (r) => (
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate(`/invoices/${r.id}`)}>
            Ouvrir
          </Button>
        ),
      },
    ],
    [navigate]
  );

  return (
    <div className="qb-page fin-pole-shell fin-standard-page">
      <PageHeader
        eyebrow="Finance"
        title="Factures"
        description="Encaissements, echeances et creation de factures depuis les devis acceptes."
        actions={
          <>
            <Link to="/finance" className="sn-btn sn-btn-ghost sn-btn-sm">Vue d'ensemble</Link>
            <Link to="/quotes" className="sn-btn sn-btn-ghost sn-btn-sm">Devis</Link>
            <Button type="button" variant="primary" size="sm" onClick={() => setQuoteModal(true)}>Creer depuis devis</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/invoices/new")}>Facture manuelle</Button>
          </>
        }
        meta={<span className="sn-badge sn-badge-neutral">{filtered.length} factures affichees</span>}
      />

      <ActionBar
        className="fin-standard-filters"
        primary={
          <>
            <label className="fin-standard-field fin-standard-field--search">
              <span>Recherche</span>
              <input
                id="fin-invoices-search"
                type="search"
                className="sn-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Numero, client, contact"
                autoComplete="off"
              />
            </label>
            <label className="fin-standard-field">
              <span>Statut</span>
              <select className="sn-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as InvStatusFilter)}>
                <option value="ALL">Tous</option>
                <option value="DRAFT">Brouillon</option>
                <option value="ISSUED">Emise</option>
                <option value="PARTIAL">Partiel</option>
                <option value="PAID">Payee</option>
                <option value="OVERDUE">En retard</option>
              </select>
            </label>
            <label className="fin-standard-field">
              <span>Periode</span>
              <select
                className="sn-input"
                value={periodFilter}
                disabled={useCustomDateRange}
                onChange={(e) => setPeriodFilter(e.target.value as InvPeriodFilter)}
              >
                <option value="ALL">Toutes</option>
                <option value="WEEK">Semaine</option>
                <option value="MONTH">Mois en cours</option>
                <option value="YEAR">Annee en cours</option>
              </select>
            </label>
          </>
        }
        secondary={
          <>
            <label className="fin-standard-field">
              <span>Du</span>
              <input type="date" className="sn-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="fin-standard-field">
              <span>Au</span>
              <input type="date" className="sn-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="fin-standard-field fin-standard-field--wide">
              <span>Filtrer sur</span>
              <select className="sn-input" value={dateRangeBasis} onChange={(e) => setDateRangeBasis(e.target.value as InvDateRangeBasis)}>
                <option value="EITHER">Creation ou modification</option>
                <option value="CREATED">Creation</option>
                <option value="UPDATED">Modification</option>
              </select>
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={handleResetFilters}>Reinitialiser</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Actualiser</Button>
          </>
        }
      />

      {error ? <p className="qb-error-inline">{error}</p> : null}

      {!loading && rows.length === 0 ? (
        <EmptyState
          title="Aucune facture"
          description="La facture doit idealement partir d'un devis accepte pour garder le lien lead, client, document et paiement."
          actions={
            <>
              <Button type="button" variant="primary" onClick={() => setQuoteModal(true)}>Creer depuis devis</Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/quotes?status=ACCEPTED")}>Voir les devis acceptes</Button>
            </>
          }
        />
      ) : (
        <DataTable
          dense
          loading={loading}
          columns={columns}
          rows={filtered}
          getRowKey={(row) => row.id}
          emptyTitle="Aucune facture ne correspond aux filtres"
          emptyDescription="Elargissez la periode, changez le statut ou effacez la recherche."
          className="fin-standard-table"
        />
      )}

      <ModalShell
        open={quoteModal}
        onClose={() => setQuoteModal(false)}
        title="Creer depuis un devis"
        subtitle="Seuls les devis acceptes sont proposes. Pour un acompte ou un solde, ouvrez le devis et utilisez ses liens Facturation."
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setQuoteModal(false)}>Fermer</Button>
            <Button
              type="button"
              variant="primary"
              disabled={creating || !selectedQuote || !quoteRowCanInvoice(selectedQuote)}
              onClick={() => void createFromSelectedQuote()}
            >
              {creating ? "Creation..." : "Creer la facture"}
            </Button>
          </>
        }
      >
        <div className="fin-standard-modal-stack">
          <label className="fin-standard-field fin-standard-field--full">
            <span>Rechercher un devis</span>
            <input
              className="sn-input"
              value={quoteSearch}
              onChange={(e) => setQuoteSearch(e.target.value)}
              placeholder="Numero ou nom client"
              autoComplete="off"
            />
          </label>
          {quotesLoading ? <p className="qb-muted">Chargement des devis acceptes...</p> : null}
          {quoteModalError ? <p className="qb-error-inline" role="alert">{quoteModalError}</p> : null}
          {!quotesLoading && quotesForPicker.length === 0 ? (
            <EmptyState title="Aucun devis accepte" description="Validez un devis avant de creer une facture rattachee." />
          ) : null}
          {!quotesLoading && quotePickerOptions.length > 0 ? (
            <div className="fin-saas-quote-ac" role="listbox" aria-label="Selection de devis">
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
                    <span className="qb-mono">{q.quote_number || q.id.slice(0, 8)}</span>
                    <span>{formatQuoteContact(q)}</span>
                    <span className="fin-standard-amount">{eur(quoteDisplayTotals(q).total_ttc)}</span>
                    {blocked ? <span className="fin-saas-quote-ac-row__hint">{reason}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          {!quotesLoading && quotesForPicker.length > 0 && quotePickerOptions.length === 0 ? (
            <EmptyState title="Aucun resultat" description="Essayez un autre numero ou nom client." />
          ) : null}
        </div>
      </ModalShell>
    </div>
  );
}
