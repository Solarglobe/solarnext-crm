/**
 * Hub financier - pilotage SaaS standardise.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ActionBar,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from "../components/ui";
import { fetchInvoicesList, fetchQuotesList, type InvoiceListRow, type QuoteListRow } from "../services/financial.api";
import { quoteDisplayTotals } from "../services/quotes.service";
import { formatInvoiceStatusFr, formatQuoteStatusFr } from "../modules/finance/financialLabels";
import { formatInvoiceNumberDisplay, formatQuoteNumberDisplay } from "../modules/finance/documentDisplay";
import "../modules/leads/LeadDetail/financial/financial-tab.css";
import "../modules/finance/financial-pole.css";
import "../modules/finance/financial-list-saas.css";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n)
    ? `${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} EUR`
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

function normInvStatus(s: string | undefined) {
  return String(s || "").trim().toUpperCase();
}

function isInvoiceEmitted(inv: InvoiceListRow): boolean {
  const st = normInvStatus(inv.status);
  return st !== "DRAFT" && st !== "CANCELLED";
}

function formatInvoiceClient(row: InvoiceListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_id) return "Lead (sans fiche client)";
  return "-";
}

function formatQuoteClient(row: QuoteListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_full_name?.trim()) return row.lead_full_name.trim();
  return "-";
}

function quoteRowDateMs(q: QuoteListRow): number {
  const raw = q.updated_at || q.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function invoiceRowDateMs(inv: InvoiceListRow): number {
  const raw = inv.issue_date || inv.created_at;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function invoicePriority(inv: InvoiceListRow): number {
  const st = String(inv.status).toUpperCase();
  if (isInvoiceOverdue(inv)) return 0;
  if (st === "PARTIALLY_PAID" || st === "PARTIAL") return 1;
  if (st === "ISSUED" && toAmount(inv.amount_due) > 0) return 2;
  return 3;
}

type FinanceMetric = {
  id: string;
  label: string;
  value: string | number;
  hint: string;
  to?: string;
  tone?: "default" | "danger";
};

export default function FinancialHubPage() {
  const [quoteRows, setQuoteRows] = useState<QuoteListRow[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErr(null);
    try {
      const [q, inv] = await Promise.all([fetchQuotesList({ limit: 500 }), fetchInvoicesList({ limit: 500 })]);
      setQuoteRows(Array.isArray(q) ? q : []);
      setInvoiceRows(Array.isArray(inv) ? inv : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo(() => {
    const quoteDraft = quoteRows.filter((q) => String(q.status).toUpperCase() === "DRAFT");
    const quoteSent = quoteRows.filter((q) => {
      const st = String(q.status).toUpperCase();
      return st === "SENT" || st === "READY_TO_SEND";
    });
    const quoteAccepted = quoteRows.filter((q) => String(q.status).toUpperCase() === "ACCEPTED");
    const invDraft = invoiceRows.filter((inv) => normInvStatus(inv.status) === "DRAFT");
    const invEmitted = invoiceRows.filter(isInvoiceEmitted);
    const invOverdue = invoiceRows.filter(isInvoiceOverdue);
    const sentAmountTtc = quoteSent.reduce((acc, q) => acc + quoteDisplayTotals(q).total_ttc, 0);
    const billedTtc = invEmitted.reduce((acc, inv) => acc + toAmount(inv.total_ttc), 0);
    const collected = invEmitted.reduce((acc, inv) => acc + toAmount(inv.total_paid), 0);
    const remainingDue = invEmitted.reduce((acc, inv) => acc + toAmount(inv.amount_due), 0);
    return {
      quoteDraftCount: quoteDraft.length,
      quoteSentCount: quoteSent.length,
      quoteAcceptedCount: quoteAccepted.length,
      invDraftCount: invDraft.length,
      invEmittedCount: invEmitted.length,
      overdueCount: invOverdue.length,
      overdueAmount: invOverdue.reduce((acc, inv) => acc + toAmount(inv.amount_due), 0),
      sentAmountTtc,
      billedTtc,
      collected,
      remainingDue,
    };
  }, [quoteRows, invoiceRows]);

  const metrics = useMemo<FinanceMetric[]>(
    () => [
      { id: "quoteDraft", label: "Devis brouillons", value: kpis.quoteDraftCount, hint: "A finaliser", to: "/quotes?status=DRAFT" },
      { id: "quoteSent", label: "Devis envoyes", value: kpis.quoteSentCount, hint: `${eur(kpis.sentAmountTtc)} proposes`, to: "/quotes?status=SENT" },
      { id: "quoteAccepted", label: "Devis acceptes", value: kpis.quoteAcceptedCount, hint: "Prets pour facturation", to: "/quotes?status=ACCEPTED" },
      { id: "invDraft", label: "Factures brouillons", value: kpis.invDraftCount, hint: "Avant emission", to: "/invoices?status=DRAFT" },
      { id: "invEmitted", label: "Factures emises", value: kpis.invEmittedCount, hint: "Hors brouillon et annulees", to: "/invoices" },
      {
        id: "overdue",
        label: "Factures en retard",
        value: kpis.overdueCount,
        hint: `${eur(kpis.overdueAmount)} reste du`,
        to: "/invoices?status=OVERDUE",
        tone: kpis.overdueCount > 0 ? "danger" : "default",
      },
      { id: "billed", label: "Montant facture", value: eur(kpis.billedTtc), hint: "TTC emis" },
      { id: "collected", label: "Montant encaisse", value: eur(kpis.collected), hint: "Cumul paiements" },
      { id: "remaining", label: "Reste a encaisser", value: eur(kpis.remainingDue), hint: "Solde du" },
    ],
    [kpis]
  );

  const highlightedInvoices = useMemo(
    () => [...invoiceRows].sort((a, b) => {
      const p = invoicePriority(a) - invoicePriority(b);
      return p !== 0 ? p : invoiceRowDateMs(b) - invoiceRowDateMs(a);
    }).slice(0, 5),
    [invoiceRows]
  );

  const latestQuotes = useMemo(
    () => [...quoteRows].sort((a, b) => quoteRowDateMs(b) - quoteRowDateMs(a)).slice(0, 5),
    [quoteRows]
  );

  const quoteColumns = useMemo<DataTableColumn<QuoteListRow>[]>(
    () => [
      { id: "number", header: "Numero", render: (q) => <span className="qb-mono">{formatQuoteNumberDisplay(q.quote_number, q.status)}</span> },
      { id: "client", header: "Client", render: (q) => formatQuoteClient(q) },
      { id: "amount", header: "Montant", align: "right", render: (q) => eur(quoteDisplayTotals(q).total_ttc) },
      { id: "status", header: "Statut", render: (q) => <span className="sn-badge sn-badge-neutral">{formatQuoteStatusFr(q.status)}</span> },
      { id: "date", header: "Date", render: (q) => fmtDate(q.updated_at || q.created_at) },
      { id: "actions", header: "Actions", align: "right", render: (q) => <Link to={`/quotes/${q.id}`} className="sn-btn sn-btn-ghost sn-btn-sm">Ouvrir</Link> },
    ],
    []
  );

  const invoiceColumns = useMemo<DataTableColumn<InvoiceListRow>[]>(
    () => [
      { id: "number", header: "Numero", render: (inv) => <span className="qb-mono">{formatInvoiceNumberDisplay(inv.invoice_number, inv.status)}</span> },
      { id: "client", header: "Client", render: (inv) => formatInvoiceClient(inv) },
      { id: "due", header: "Reste", align: "right", render: (inv) => eur(inv.amount_due) },
      {
        id: "status",
        header: "Statut",
        render: (inv) => (
          <span className={`sn-badge ${isInvoiceOverdue(inv) ? "sn-badge-danger" : "sn-badge-neutral"}`}>
            {isInvoiceOverdue(inv) ? "En retard" : formatInvoiceStatusFr(inv.status)}
          </span>
        ),
      },
      { id: "date", header: "Echeance", render: (inv) => fmtDate(inv.due_date ?? inv.issue_date) },
      { id: "actions", header: "Actions", align: "right", render: (inv) => <Link to={`/invoices/${inv.id}`} className="sn-btn sn-btn-ghost sn-btn-sm">Ouvrir</Link> },
    ],
    []
  );

  return (
    <div className="fin-hub fin-pole-shell fin-standard-page">
      <PageHeader
        eyebrow="Finance"
        title="Vue d'ensemble financiere"
        description="Volumes, encours, devis recents et factures a suivre."
        actions={
          <>
            <Link to="/leads" className="sn-btn sn-btn-primary sn-btn-sm">Creer un devis</Link>
            <Link to="/quotes" className="sn-btn sn-btn-ghost sn-btn-sm">Devis</Link>
            <Link to="/invoices" className="sn-btn sn-btn-ghost sn-btn-sm">Factures</Link>
          </>
        }
        meta={<span className="sn-badge sn-badge-neutral">{quoteRows.length + invoiceRows.length} documents charges</span>}
      />

      <ActionBar
        primary={
          <>
            <Link to="/invoices?status=OVERDUE" className="sn-btn sn-btn-ghost sn-btn-sm">En retard</Link>
            <Link to="/invoices/new" className="sn-btn sn-btn-ghost sn-btn-sm">Nouvelle facture</Link>
          </>
        }
        secondary={<Button type="button" variant="ghost" size="sm" onClick={() => void load(true)} disabled={refreshing}>{refreshing ? "Actualisation..." : "Actualiser"}</Button>}
      />

      {err ? <p className="qb-error-inline">{err}</p> : null}

      <section className="fin-standard-metrics" aria-label="Indicateurs financiers">
        {metrics.map((m) => {
          const content = (
            <>
              <span className="fin-standard-metric__label">{m.label}</span>
              <strong className="fin-standard-metric__value">{m.value}</strong>
              <span className="fin-standard-metric__hint">{m.hint}</span>
            </>
          );
          return m.to ? (
            <Link key={m.id} to={m.to} className={`fin-standard-metric${m.tone === "danger" ? " fin-standard-metric--danger" : ""}`}>
              {content}
            </Link>
          ) : (
            <article key={m.id} className="fin-standard-metric">{content}</article>
          );
        })}
      </section>

      {kpis.overdueCount > 0 ? (
        <section className="fin-standard-alert fin-standard-alert--danger" role="alert">
          <div>
            <strong>{kpis.overdueCount} facture{kpis.overdueCount > 1 ? "s" : ""} en retard</strong>
            <p>{eur(kpis.overdueAmount)} restent a encaisser sur des echeances depassees.</p>
          </div>
          <Link to="/invoices?status=OVERDUE" className="sn-btn sn-btn-secondary sn-btn-sm">Voir les factures</Link>
        </section>
      ) : (
        <section className="fin-standard-alert">
          <p>Aucune facture en retard. Le suivi d'encaissement est a jour.</p>
        </section>
      )}

      <div className="fin-standard-grid">
        {latestQuotes.length === 0 && !loading ? (
          <EmptyState
            title="Aucun devis récent"
            description="Les devis créés depuis les fiches lead apparaîtront ici."
            actions={<Link to="/quotes" className="sn-btn sn-btn-outline sn-btn-sm">Voir tous les devis</Link>}
          />
        ) : (
          <DataTable
            dense
            loading={loading}
            columns={quoteColumns}
            rows={latestQuotes}
            getRowKey={(row) => row.id}
            title="Devis recents"
            actions={<Link to="/quotes" className="sn-btn sn-btn-ghost sn-btn-sm">Liste complete</Link>}
            emptyTitle="Aucun devis recent"
            className="fin-standard-table"
          />
        )}

        {highlightedInvoices.length === 0 && !loading ? (
          <EmptyState
            title="Aucune facture à suivre"
            description="Les factures en retard, partielles ou récentes apparaîtront ici."
            actions={<Link to="/invoices" className="sn-btn sn-btn-outline sn-btn-sm">Voir toutes les factures</Link>}
          />
        ) : (
          <DataTable
            dense
            loading={loading}
            columns={invoiceColumns}
            rows={highlightedInvoices}
            getRowKey={(row) => row.id}
            title="Factures à suivre"
            actions={<Link to="/invoices" className="sn-btn sn-btn-ghost sn-btn-sm">Liste complète</Link>}
            emptyTitle="Aucune facture à suivre"
            className="fin-standard-table"
          />
        )}
      </div>
    </div>
  );
}
