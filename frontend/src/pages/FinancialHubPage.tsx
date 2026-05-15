/**
 * Hub financier — pilotage (KPIs + accès directs + aperçu récent).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchInvoicesList, fetchQuotesList, type InvoiceListRow, type QuoteListRow } from "../services/financial.api";
import { quoteDisplayTotals } from "../services/quotes.service";
import { formatInvoiceStatusFr, formatQuoteStatusFr } from "../modules/finance/financialLabels";
import { formatInvoiceNumberDisplay, formatQuoteNumberDisplay } from "../modules/finance/documentDisplay";
import "../modules/leads/LeadDetail/financial/financial-tab.css";
import "../modules/finance/financial-pole.css";

function eur(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €" : "—";
}

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("fr-FR", { dateStyle: "short" }); }
  catch { return "—"; }
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
  return "—";
}

function formatQuoteClient(row: QuoteListRow): string {
  if (row.company_name?.trim()) return row.company_name.trim();
  const parts = [row.first_name, row.last_name].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  if (row.lead_full_name?.trim()) return row.lead_full_name.trim();
  return "—";
}

function quoteStatusTone(status: string): "neutral" | "info" | "success" | "warning" | "danger" {
  const st = String(status).toUpperCase();
  if (st === "DRAFT") return "neutral";
  if (["READY_TO_SEND", "SENT"].includes(st)) return "info";
  if (st === "ACCEPTED") return "success";
  if (["EXPIRED"].includes(st)) return "warning";
  if (["REJECTED", "CANCELLED"].includes(st)) return "danger";
  return "neutral";
}

function invoiceStatusTone(status: string, overdue: boolean): "neutral" | "info" | "success" | "warning" | "danger" {
  const st = String(status).toUpperCase();
  if (overdue) return "danger";
  if (st === "PAID") return "success";
  if (st === "PARTIALLY_PAID" || st === "PARTIAL") return "warning";
  if (st === "ISSUED") return "info";
  return "neutral";
}

function badgeClass(tone: "neutral" | "info" | "success" | "warning" | "danger"): string {
  const mod = tone === "warning" ? "sn-badge-warn" : `sn-badge-${tone}`;
  return `sn-badge ${mod}`;
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
  const overdue = isInvoiceOverdue(inv);
  if (overdue) return 0;
  if (st === "PARTIALLY_PAID" || st === "PARTIAL") return 1;
  if (st === "ISSUED" && toAmount(inv.amount_due) > 0) return 2;
  return 3;
}

/* ── Icons ─────────────────────────────────────────────────────────────── */
const IconRefresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
  </svg>
);
const IconEye = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const IconCheck = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconWarn = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

/* KPI icons */
const IcoFileDraft = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>;
const IcoSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IcoCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
const IcoInvDraft = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;
const IcoReceipt = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>;
const IcoAlert = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const IcoBilled = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
const IcoCollected = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>;
const IcoDue = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;

/* ── Component ─────────────────────────────────────────────────────────── */
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

  useEffect(() => { void load(); }, [load]);

  const kpis = useMemo(() => {
    const quoteDraft    = quoteRows.filter((q) => String(q.status).toUpperCase() === "DRAFT");
    const quoteSent     = quoteRows.filter((q) => { const st = String(q.status).toUpperCase(); return st === "SENT" || st === "READY_TO_SEND"; });
    const quoteAccepted = quoteRows.filter((q) => String(q.status).toUpperCase() === "ACCEPTED");
    const invDraft      = invoiceRows.filter((inv) => normInvStatus(inv.status) === "DRAFT");
    const invEmitted    = invoiceRows.filter(isInvoiceEmitted);
    const invOverdue    = invoiceRows.filter(isInvoiceOverdue);
    const sentAmountTtc = quoteSent.reduce((acc, q) => acc + quoteDisplayTotals(q).total_ttc, 0);
    const billedTtc     = invEmitted.reduce((acc, inv) => acc + toAmount(inv.total_ttc), 0);
    const collected     = invEmitted.reduce((acc, inv) => acc + toAmount(inv.total_paid), 0);
    const remainingDue  = invEmitted.reduce((acc, inv) => acc + toAmount(inv.amount_due), 0);
    return {
      quoteDraftCount: quoteDraft.length,
      quoteSentCount: quoteSent.length,
      quoteAcceptedCount: quoteAccepted.length,
      invDraftCount: invDraft.length,
      invEmittedCount: invEmitted.length,
      overdueCount: invOverdue.length,
      overdueAmount: invOverdue.reduce((acc, inv) => acc + toAmount(inv.amount_due), 0),
      sentAmountTtc, billedTtc, collected, remainingDue,
    };
  }, [quoteRows, invoiceRows]);

  const highlightedInvoices = useMemo(
    () => [...invoiceRows].sort((a, b) => { const p = invoicePriority(a) - invoicePriority(b); return p !== 0 ? p : invoiceRowDateMs(b) - invoiceRowDateMs(a); }).slice(0, 5),
    [invoiceRows]
  );

  const latestQuotes = useMemo(
    () => [...quoteRows].sort((a, b) => quoteRowDateMs(b) - quoteRowDateMs(a)).slice(0, 5),
    [quoteRows]
  );

  return (
    <div className="fin-hub fin-hub-premium fin-pole-shell fin-pole-shell--padded">

      {/* ── Header compact ── */}
      <div className="fin-hub-header">
        <div>
          <h1 className="fin-hub-title">Vue d'ensemble financière</h1>
          <p className="fin-hub-subtitle">Volumes, encours et derniers mouvements</p>
        </div>
        <button
          type="button"
          className={`fin-hub-refresh-btn${refreshing ? " fin-hub-refresh-btn--spin" : ""}`}
          title="Actualiser"
          onClick={() => void load(true)}
        >
          <IconRefresh />
        </button>
      </div>

      {/* ── CTA toolbar sans gradient ── */}
      <div className="fin-hub-toolbar" role="navigation" aria-label="Accès rapides pôle financier">
        <Link to="/leads" className="sn-btn sn-btn-primary" style={{ textDecoration: "none" }}>Créer un devis</Link>
        <Link to="/quotes" className="sn-btn sn-btn-outline-gold" style={{ textDecoration: "none" }}>Devis</Link>
        <Link to="/invoices" className="sn-btn sn-btn-outline-gold" style={{ textDecoration: "none" }}>Factures</Link>
        <Link to="/invoices?status=OVERDUE" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>En retard</Link>
        <Link to="/invoices/new" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }} title="Facture vierge">Nouvelle facture</Link>
      </div>

      {/* ── KPI cards ── */}
      <section className="fin-preview-kpis fin-preview-kpis--dashboard" aria-label="Indicateurs clés">
        <Link to="/quotes?status=DRAFT" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-kpi-icon fin-kpi-icon--draft"><IcoFileDraft /></span>
          <span className="fin-preview-kpi-label">Devis brouillons</span>
          <strong className="fin-preview-kpi-value">{kpis.quoteDraftCount}</strong>
          <span className="fin-preview-kpi-sub">À finaliser ou envoyer</span>
        </Link>
        <Link to="/quotes?status=SENT" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-kpi-icon fin-kpi-icon--sent"><IcoSend /></span>
          <span className="fin-preview-kpi-label">Devis envoyés</span>
          <strong className="fin-preview-kpi-value">{kpis.quoteSentCount}</strong>
          <span className="fin-preview-kpi-sub">{eur(kpis.sentAmountTtc)} proposés</span>
        </Link>
        <Link to="/quotes?status=ACCEPTED" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-kpi-icon fin-kpi-icon--accepted"><IcoCheck /></span>
          <span className="fin-preview-kpi-label">Devis acceptés</span>
          <strong className="fin-preview-kpi-value">{kpis.quoteAcceptedCount}</strong>
          <span className="fin-preview-kpi-sub">Prêts pour facturation</span>
        </Link>
        <Link to="/invoices?status=DRAFT" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-kpi-icon fin-kpi-icon--inv"><IcoInvDraft /></span>
          <span className="fin-preview-kpi-label">Factures brouillons</span>
          <strong className="fin-preview-kpi-value">{kpis.invDraftCount}</strong>
          <span className="fin-preview-kpi-sub">Avant émission</span>
        </Link>
        <Link to="/invoices" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-kpi-icon fin-kpi-icon--emitted"><IcoReceipt /></span>
          <span className="fin-preview-kpi-label">Factures émises</span>
          <strong className="fin-preview-kpi-value">{kpis.invEmittedCount}</strong>
          <span className="fin-preview-kpi-sub">Hors brouillon & annulées</span>
        </Link>
        <Link
          to="/invoices?status=OVERDUE"
          className={`fin-preview-kpi-card fin-preview-kpi-card--link${kpis.overdueCount > 0 ? " fin-preview-kpi-card--danger" : ""}`}
        >
          <span className={`fin-kpi-icon fin-kpi-icon--danger`}><IcoAlert /></span>
          <span className="fin-preview-kpi-label">Factures en retard</span>
          <strong className="fin-preview-kpi-value">{kpis.overdueCount}</strong>
          <span className="fin-preview-kpi-sub">{eur(kpis.overdueAmount)} reste dû</span>
        </Link>
        <article className="fin-preview-kpi-card">
          <span className="fin-kpi-icon fin-kpi-icon--billed"><IcoBilled /></span>
          <span className="fin-preview-kpi-label">Montant facturé (TTC)</span>
          <strong className="fin-preview-kpi-value">{eur(kpis.billedTtc)}</strong>
          <span className="fin-preview-kpi-sub">Factures émises</span>
        </article>
        <article className="fin-preview-kpi-card">
          <span className="fin-kpi-icon fin-kpi-icon--collected"><IcoCollected /></span>
          <span className="fin-preview-kpi-label">Montant encaissé</span>
          <strong className="fin-preview-kpi-value">{eur(kpis.collected)}</strong>
          <span className="fin-preview-kpi-sub">Cumul des paiements</span>
        </article>
        <article className="fin-preview-kpi-card">
          <span className="fin-kpi-icon fin-kpi-icon--due"><IcoDue /></span>
          <span className="fin-preview-kpi-label">Reste à encaisser</span>
          <strong className="fin-preview-kpi-value">{eur(kpis.remainingDue)}</strong>
          <span className="fin-preview-kpi-sub">Solde dû sur émises</span>
        </article>
      </section>

      {/* ── Alert banner ── */}
      {kpis.overdueCount > 0 ? (
        <section className="fin-preview-alert fin-preview-alert--danger" role="alert">
          <span className="fin-alert-icon fin-alert-icon--danger"><IconWarn /></span>
          <div>
            <p className="fin-preview-alert-title">
              {kpis.overdueCount} facture{kpis.overdueCount > 1 ? "s" : ""} en retard
            </p>
            <p className="fin-preview-alert-sub">{eur(kpis.overdueAmount)} restent à encaisser sur des échéances dépassées.</p>
          </div>
          <Link to="/invoices?status=OVERDUE" className="sn-btn sn-btn-outline-gold" style={{ textDecoration: "none", marginLeft: "auto" }}>
            Voir les factures
          </Link>
        </section>
      ) : (
        <section className="fin-preview-alert fin-preview-alert--ok">
          <span className="fin-alert-icon fin-alert-icon--ok"><IconCheck /></span>
          <p className="fin-preview-alert-sub" style={{ margin: 0 }}>Aucune facture en retard — tout est à jour.</p>
        </section>
      )}

      {err ? <p className="qb-error-inline">{err}</p> : null}
      {loading ? (
        <div style={{ display: "flex", gap: 8, padding: "16px 0" }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ flex: 1, height: 100, borderRadius: 14, background: "color-mix(in srgb, var(--text-muted) 10%, transparent)", animation: "dp-shimmer 1.4s ease-in-out infinite" }} />
          ))}
        </div>
      ) : null}

      {/* ── Panneaux Devis + Factures ── */}
      <div className="fin-preview-stack">
        <section className="fin-preview-panel">
          <div className="fin-preview-panel-head">
            <div>
              <h2 className="fin-preview-panel-title">Devis récents</h2>
              <p className="fin-preview-panel-sub">5 derniers mouvements</p>
            </div>
            <div className="fin-preview-panel-actions">
              <Link to="/quotes" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>Liste complète</Link>
              <Link to="/leads" className="sn-btn sn-btn-primary" style={{ textDecoration: "none" }}>Créer un devis</Link>
            </div>
          </div>

          {latestQuotes.length === 0 ? <p className="fin-muted">Aucun devis dans le périmètre chargé.</p> : null}
          <div className="fin-preview-list">
            {latestQuotes.map((q) => (
              <article key={q.id} className="fin-doc-row-v2">
                <div className="fin-doc-row-v2__main">
                  <p className="fin-doc-row-v2__title">{formatQuoteNumberDisplay(q.quote_number, q.status)}</p>
                  <p className="fin-doc-row-v2__sub">{formatQuoteClient(q)} · {fmtDate(q.updated_at || q.created_at)}</p>
                </div>
                <span className="fin-doc-row-v2__amount">{eur(quoteDisplayTotals(q).total_ttc)}</span>
                <span className={badgeClass(quoteStatusTone(q.status))}>{formatQuoteStatusFr(q.status)}</span>
                <div className="fin-doc-row-v2__actions">
                  <Link to={`/quotes/${q.id}`} className="fin-icon-btn" title="Ouvrir" style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", transition: "all 0.1s" }}>
                    <IconEye />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="fin-preview-panel">
          <div className="fin-preview-panel-head">
            <div>
              <h2 className="fin-preview-panel-title">Factures à suivre</h2>
              <p className="fin-preview-panel-sub">En retard → partiel → encours</p>
            </div>
            <div className="fin-preview-panel-actions">
              <Link to="/invoices" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>Liste complète</Link>
              <Link to="/invoices/new" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>Nouvelle facture</Link>
            </div>
          </div>

          {highlightedInvoices.length === 0 ? <p className="fin-muted">Aucune facture dans le périmètre chargé.</p> : null}
          <div className="fin-preview-list">
            {highlightedInvoices.map((inv) => {
              const overdue = isInvoiceOverdue(inv);
              return (
                <article key={inv.id} className={`fin-doc-row-v2${overdue ? " fin-doc-row-v2--critical" : ""}`}>
                  <div className="fin-doc-row-v2__main">
                    <p className="fin-doc-row-v2__title">{formatInvoiceNumberDisplay(inv.invoice_number, inv.status)}</p>
                    <p className="fin-doc-row-v2__sub">{formatInvoiceClient(inv)} · Éch. {fmtDate(inv.due_date ?? inv.issue_date)}</p>
                  </div>
                  <span className="fin-doc-row-v2__amount">{eur(inv.amount_due)}</span>
                  <span className={badgeClass(invoiceStatusTone(inv.status, overdue))}>
                    {overdue ? "En retard" : formatInvoiceStatusFr(inv.status)}
                  </span>
                  <div className="fin-doc-row-v2__actions">
                    <Link to={`/invoices/${inv.id}`} className="fin-icon-btn" title="Ouvrir" style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", transition: "all 0.1s" }}>
                      <IconEye />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
