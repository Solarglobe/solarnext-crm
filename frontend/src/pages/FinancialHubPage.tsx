/**
 * Hub financier — pilotage (KPIs + accès directs + aperçu récent).
 * Les totaux sont dérivés des listes API (limite 500 par type), sans logique métier supplémentaire.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
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

function normInvStatus(s: string | undefined) {
  return String(s || "")
    .trim()
    .toUpperCase();
}

/** Facture « émise » : hors brouillon et hors annulée (vue pilotage). */
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
  if (st === "DRAFT") return "neutral";
  if (st === "CANCELLED") return "neutral";
  return "neutral";
}

function hubStatusBadgeClass(tone: "neutral" | "info" | "success" | "warning" | "danger"): string {
  const mod = tone === "warning" ? "sn-badge-warn" : `sn-badge-${tone}`;
  return `sn-badge ${mod}`;
}

function quoteSubtitle(q: QuoteListRow): string {
  if (q.company_name) return q.company_name;
  const fullName = [q.first_name, q.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (q.lead_full_name) return q.lead_full_name;
  return "Sans client associé";
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

export default function FinancialHubPage() {
  const [quoteRows, setQuoteRows] = useState<QuoteListRow[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<InvoiceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [q, inv] = await Promise.all([fetchQuotesList({ limit: 500 }), fetchInvoicesList({ limit: 500 })]);
      setQuoteRows(Array.isArray(q) ? q : []);
      setInvoiceRows(Array.isArray(inv) ? inv : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
    } finally {
      setLoading(false);
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
    const invOverdue = invoiceRows.filter((inv) => isInvoiceOverdue(inv));
    const sentAmountTtc = quoteSent.reduce((acc, q) => acc + quoteDisplayTotals(q).total_ttc, 0);
    const billedTtc = invEmitted.reduce((acc, inv) => acc + toAmount(inv.total_ttc), 0);
    const collected = invEmitted.reduce((acc, inv) => acc + toAmount(inv.total_paid), 0);
    const remainingDue = invEmitted.reduce((acc, inv) => acc + toAmount(inv.amount_due), 0);
    const paidThisMonth = invoiceRows.filter((inv) => {
      if (normInvStatus(inv.status) !== "PAID") return false;
      const issue = String(inv.issue_date ?? "").slice(0, 7);
      return issue === new Date().toISOString().slice(0, 7);
    }).length;
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
      paidThisMonth,
    };
  }, [quoteRows, invoiceRows]);

  const highlightedInvoices = useMemo(
    () =>
      [...invoiceRows]
        .sort((a, b) => {
          const p = invoicePriority(a) - invoicePriority(b);
          if (p !== 0) return p;
          return invoiceRowDateMs(b) - invoiceRowDateMs(a);
        })
        .slice(0, 5),
    [invoiceRows]
  );

  const latestQuotes = useMemo(
    () => [...quoteRows].sort((a, b) => quoteRowDateMs(b) - quoteRowDateMs(a)).slice(0, 5),
    [quoteRows]
  );

  return (
    <div className="fin-hub fin-hub-premium fin-pole-shell fin-pole-shell--padded">
      <header className="fin-pole-hub-hero">
        <h1 className="sg-title">Vue d’ensemble financière</h1>
        <p className="fin-pole-lead" style={{ marginTop: 0 }}>
          Tableau de bord : volumes, encours et derniers documents. L’édition détaillée se fait dans les listes Devis et
          Factures ; les fiches Lead et Client restent le centre relationnel.
        </p>
        <p className="fin-pole-footnote">
          Les indicateurs sont calculés à partir des 500 derniers devis et des 500 dernières factures renvoyés par l’API
          (même périmètre que les listes). Hors de cette fenêtre, les totaux peuvent être incomplets.
        </p>
      </header>

      <div className="fin-hub-toolbar" role="navigation" aria-label="Accès rapides pôle financier">
        <Link to="/leads" className="sn-btn sn-btn-primary" style={{ textDecoration: "none" }}>
          Créer un devis
        </Link>
        <Link to="/quotes" className="sn-btn sn-btn-outline-gold" style={{ textDecoration: "none" }}>
          Voir les devis
        </Link>
        <Link to="/invoices" className="sn-btn sn-btn-outline-gold" style={{ textDecoration: "none" }}>
          Voir les factures
        </Link>
        <Link to="/invoices?status=OVERDUE" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>
          Factures en retard
        </Link>
        <Link
          to="/invoices/new"
          className="sn-btn sn-btn-ghost"
          style={{ textDecoration: "none", opacity: 0.9 }}
          title="Facture vierge — la facturation courante part du devis accepté"
        >
          Nouvelle facture
        </Link>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
          Actualiser
        </Button>
      </div>

      <section className="fin-preview-kpis fin-preview-kpis--dashboard" aria-label="Indicateurs clés">
        <Link to="/quotes?status=DRAFT" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-preview-kpi-label">Devis brouillons</span>
          <strong className="fin-preview-kpi-value">{kpis.quoteDraftCount}</strong>
          <span className="fin-preview-kpi-sub">À finaliser ou envoyer</span>
        </Link>
        <Link to="/quotes?status=SENT" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-preview-kpi-label">Devis envoyés</span>
          <strong className="fin-preview-kpi-value">{kpis.quoteSentCount}</strong>
          <span className="fin-preview-kpi-sub">{eur(kpis.sentAmountTtc)} proposés (TTC)</span>
        </Link>
        <Link to="/quotes?status=ACCEPTED" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-preview-kpi-label">Devis acceptés</span>
          <strong className="fin-preview-kpi-value">{kpis.quoteAcceptedCount}</strong>
          <span className="fin-preview-kpi-sub">Prêts pour facturation</span>
        </Link>
        <Link to="/invoices?status=DRAFT" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-preview-kpi-label">Factures brouillons</span>
          <strong className="fin-preview-kpi-value">{kpis.invDraftCount}</strong>
          <span className="fin-preview-kpi-sub">Avant émission</span>
        </Link>
        <Link to="/invoices" className="fin-preview-kpi-card fin-preview-kpi-card--link">
          <span className="fin-preview-kpi-label">Factures émises</span>
          <strong className="fin-preview-kpi-value">{kpis.invEmittedCount}</strong>
          <span className="fin-preview-kpi-sub">Hors brouillon, annulations exclues</span>
        </Link>
        <Link to="/invoices?status=OVERDUE" className="fin-preview-kpi-card fin-preview-kpi-card--alert fin-preview-kpi-card--link">
          <span className="fin-preview-kpi-label">Factures en retard</span>
          <strong className="fin-preview-kpi-value">{kpis.overdueCount}</strong>
          <span className="fin-preview-kpi-sub">{eur(kpis.overdueAmount)} reste dû</span>
        </Link>
        <article className="fin-preview-kpi-card">
          <span className="fin-preview-kpi-label">Montant facturé (TTC)</span>
          <strong className="fin-preview-kpi-value">{eur(kpis.billedTtc)}</strong>
          <span className="fin-preview-kpi-sub">Factures émises (périmètre liste)</span>
        </article>
        <article className="fin-preview-kpi-card">
          <span className="fin-preview-kpi-label">Montant encaissé</span>
          <strong className="fin-preview-kpi-value">{eur(kpis.collected)}</strong>
          <span className="fin-preview-kpi-sub">Cumul des paiements enregistrés</span>
        </article>
        <article className="fin-preview-kpi-card">
          <span className="fin-preview-kpi-label">Reste à encaisser</span>
          <strong className="fin-preview-kpi-value">{eur(kpis.remainingDue)}</strong>
          <span className="fin-preview-kpi-sub">Sur factures émises (solde dû)</span>
        </article>
      </section>

      {kpis.overdueCount > 0 ? (
        <section className="fin-preview-alert fin-preview-alert--danger" role="alert">
          <div>
            <p className="fin-preview-alert-title">
              {kpis.overdueCount} facture{kpis.overdueCount > 1 ? "s" : ""} en retard
            </p>
            <p className="fin-preview-alert-sub">
              {eur(kpis.overdueAmount)} restent à encaisser sur des échéances dépassées.
            </p>
          </div>
          <Link to="/invoices?status=OVERDUE" className="sn-btn sn-btn-outline-gold" style={{ textDecoration: "none" }}>
            Ouvrir la liste filtrée
          </Link>
        </section>
      ) : (
        <section className="fin-preview-alert fin-preview-alert--ok">
          <p className="fin-preview-alert-sub">Aucune facture en retard sur le périmètre chargé.</p>
        </section>
      )}

      {err ? <p className="qb-error-inline">{err}</p> : null}
      {loading ? <p className="fin-muted">Chargement…</p> : null}

      <div className="fin-preview-stack">
        <section className="fin-preview-panel">
          <div className="fin-preview-panel-head">
            <div>
              <h2 className="fin-preview-panel-title">Devis récents</h2>
              <p className="fin-preview-panel-sub">Les cinq derniers mouvements (tous statuts)</p>
            </div>
            <div className="fin-preview-panel-actions">
              <Link to="/quotes" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>
                Liste complète
              </Link>
              <Link to="/leads" className="sn-btn sn-btn-primary" style={{ textDecoration: "none" }}>
                Créer un devis
              </Link>
            </div>
          </div>

          {latestQuotes.length === 0 ? <p className="fin-muted">Aucun devis dans le périmètre chargé.</p> : null}
          <div className="fin-preview-list">
            {latestQuotes.map((q) => (
              <article key={q.id} className="fin-doc-row">
                <div className="fin-doc-row-main">
                  <p className="fin-doc-row-title">{formatQuoteNumberDisplay(q.quote_number, q.status)}</p>
                  <p className="fin-doc-row-sub">{quoteSubtitle(q)}</p>
                </div>
                <div className="fin-doc-row-meta">
                  <span className="fin-doc-row-meta-label">Date</span>
                  <span className="fin-doc-row-meta-value">{fmtDate(q.updated_at || q.created_at)}</span>
                </div>
                <div className="fin-doc-row-amount">
                  <span className="fin-doc-row-meta-label">Montant TTC</span>
                  <span className="fin-doc-row-amount-value">{eur(quoteDisplayTotals(q).total_ttc)}</span>
                </div>
                <div className="fin-doc-row-status">
                  <span className={hubStatusBadgeClass(quoteStatusTone(q.status))}>{formatQuoteStatusFr(q.status)}</span>
                </div>
                <div className="fin-doc-row-actions">
                  <Link to={`/quotes/${q.id}`} className="fin-link-btn fin-link-btn--accent">
                    Ouvrir
                  </Link>
                  <span
                    className={q.has_pdf ? "sn-badge sn-badge-success" : "sn-badge sn-badge-neutral"}
                    title="PDF archivé"
                  >
                    PDF
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="fin-preview-panel">
          <div className="fin-preview-panel-head">
            <div>
              <h2 className="fin-preview-panel-title">Factures à suivre</h2>
              <p className="fin-preview-panel-sub">Priorité : retard, puis partiel, puis encours</p>
            </div>
            <div className="fin-preview-panel-actions">
              <Link to="/invoices" className="sn-btn sn-btn-ghost" style={{ textDecoration: "none" }}>
                Liste complète
              </Link>
              <Link
                to="/invoices/new"
                className="sn-btn sn-btn-ghost"
                style={{ textDecoration: "none" }}
                title="Facture vierge"
              >
                Nouvelle facture
              </Link>
            </div>
          </div>

          <p className="fin-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            Factures payées ce mois-ci (sur liste) : <strong>{kpis.paidThisMonth}</strong>
          </p>

          {highlightedInvoices.length === 0 ? <p className="fin-muted">Aucune facture dans le périmètre chargé.</p> : null}
          <div className="fin-preview-list">
            {highlightedInvoices.map((inv) => {
              const overdue = isInvoiceOverdue(inv);
              return (
                <article key={inv.id} className={`fin-doc-row ${overdue ? "fin-doc-row--critical" : ""}`}>
                  <div className="fin-doc-row-main">
                    <p className="fin-doc-row-title">{formatInvoiceNumberDisplay(inv.invoice_number, inv.status)}</p>
                    <p className="fin-doc-row-sub">
                      {formatInvoiceClient(inv)} · Échéance {fmtDate(inv.due_date ?? inv.issue_date)}
                    </p>
                  </div>
                  <div className="fin-doc-row-amount">
                    <span className="fin-doc-row-meta-label">TTC</span>
                    <span className="fin-doc-row-amount-value">{eur(inv.total_ttc)}</span>
                  </div>
                  <div className="fin-doc-row-amount">
                    <span className="fin-doc-row-meta-label">Reste dû</span>
                    <span className="fin-doc-row-amount-value">{eur(inv.amount_due)}</span>
                  </div>
                  <div className="fin-doc-row-status">
                    <span className={hubStatusBadgeClass(invoiceStatusTone(inv.status, overdue))}>
                      {overdue ? "En retard" : formatInvoiceStatusFr(inv.status)}
                    </span>
                  </div>
                  <div className="fin-doc-row-actions">
                    <Link to={`/invoices/${inv.id}`} className="fin-link-btn fin-link-btn--accent">
                      Ouvrir
                    </Link>
                    <span
                      className={inv.has_pdf ? "sn-badge sn-badge-success" : "sn-badge sn-badge-neutral"}
                      title="PDF archivé"
                    >
                      PDF
                    </span>
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
