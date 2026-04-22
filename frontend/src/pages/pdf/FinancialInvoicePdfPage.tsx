/**
 * PDF Facture client — Playwright.
 * Lignes : snapshot d’émission. Totaux / solde / paiements : état live au moment de la génération (cf. section « Document mixte »).
 * URL : financialInvoiceId, renderToken
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  buildIssuerLines,
  buildRecipientLines,
  buildRecipientTitle,
  formatDateFrLong,
  formatEurUnknown,
  formatVatRateDisplay,
} from "./financialPdfFormat";
import "./financial-invoice-pdf.css";
import { resolvePdfPrimaryColor } from "./pdfBrand";

const API_BASE = import.meta.env?.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

type Status = "loading" | "error" | "ready";

interface LiveTotals {
  status?: string | null;
  total_ht?: number;
  total_vat?: number;
  total_ttc?: number;
  total_paid?: number;
  total_credited?: number;
  amount_due?: number;
  issue_date?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
}

interface PaymentRow {
  payment_date?: string | null;
  amount?: unknown;
  payment_method?: string | null;
  reference?: string | null;
}

function getSearch() {
  if (typeof window === "undefined") return { financialInvoiceId: "", renderToken: "" };
  const s = new URLSearchParams(window.location.search);
  return { financialInvoiceId: s.get("financialInvoiceId") ?? "", renderToken: s.get("renderToken") ?? "" };
}

function statusLabel(st: string | undefined | null): string {
  const u = String(st || "").toUpperCase();
  const map: Record<string, string> = {
    ISSUED: "Émise",
    PARTIALLY_PAID: "Partiellement payée",
    PAID: "Payée",
    CANCELLED: "Annulée",
    DRAFT: "Brouillon",
  };
  return map[u] || u || "—";
}

function LegalMentionsBlock() {
  return (
    <section className="fi-legal">
      <h3>Mentions légales</h3>
      <p>
        En cas de retard de paiement, des pénalités de retard au taux légal en vigueur pourront être appliquées, ainsi
        qu&apos;une indemnité forfaitaire pour frais de recouvrement de 40 € pour les professionnels, conformément aux
        articles L.441-6 et D.441-5 du Code de commerce lorsque les conditions légales sont réunies.
      </p>
      <p style={{ marginTop: "6px" }}>
        TVA sur encaissements ou exonération : selon le régime applicable au souscripteur. En cas de litige, compétence
        des tribunaux du siège social de l&apos;émetteur, sauf disposition contraire.
      </p>
    </section>
  );
}

export default function FinancialInvoicePdfPage() {
  const { financialInvoiceId, renderToken } = useMemo(() => getSearch(), []);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [liveTotals, setLiveTotals] = useState<LiveTotals | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [defaultInvoiceNotes, setDefaultInvoiceNotes] = useState<string | null>(null);
  const [logoOk, setLogoOk] = useState(false);

  useEffect(() => {
    (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
    return () => {
      (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = false;
    };
  }, []);

  useEffect(() => {
    if (!financialInvoiceId || !renderToken) {
      setStatus("error");
      setErrMsg("Paramètres manquants : financialInvoiceId et renderToken requis.");
      return;
    }
    const url = `${API_BASE}/api/internal/pdf-financial-invoice/${encodeURIComponent(financialInvoiceId)}?renderToken=${encodeURIComponent(renderToken)}`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Chargement impossible");
        return res.json();
      })
      .then((data: {
        ok?: boolean;
        payload?: Record<string, unknown>;
        organizationId?: string;
        liveTotals?: LiveTotals;
        payments?: PaymentRow[];
        defaultInvoiceNotes?: string | null;
      }) => {
        if (data?.ok === true && data.payload) {
          setPayload(data.payload);
          setOrganizationId(data.organizationId ?? null);
          setLiveTotals(data.liveTotals ?? null);
          setPayments(Array.isArray(data.payments) ? data.payments : []);
          setDefaultInvoiceNotes(data.defaultInvoiceNotes ?? null);
          setStatus("ready");
        } else {
          throw new Error("Réponse invalide");
        }
      })
      .catch(() => {
        setErrMsg("Impossible de charger la facture figée.");
        setStatus("error");
      });
  }, [financialInvoiceId, renderToken]);

  const brandColor = useMemo(() => {
    const iss = payload?.issuer as Record<string, unknown> | undefined;
    const b = iss?.branding as Record<string, string | null> | undefined;
    return resolvePdfPrimaryColor(b?.pdf_primary_color ?? undefined);
  }, [payload]);

  const logoUrl = useMemo(() => {
    if (!organizationId || !renderToken || !financialInvoiceId) return null;
    return `${API_BASE}/api/internal/pdf-asset/${encodeURIComponent(organizationId)}/logo-for-invoice?renderToken=${encodeURIComponent(renderToken)}&invoiceId=${encodeURIComponent(financialInvoiceId)}`;
  }, [organizationId, renderToken, financialInvoiceId]);

  useEffect(() => {
    if (status !== "ready" || !payload) return;
    if (logoUrl && !logoOk) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        (window as unknown as { __pdf_render_ready?: boolean }).__pdf_render_ready = true;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [status, payload, logoUrl, logoOk]);

  if (status === "loading") {
    return (
      <div className="fi-loading" id="pdf-loading">
        Préparation du document…
      </div>
    );
  }

  if (status === "error" || !payload) {
    return (
      <div className="fi-error" id="pdf-error">
        {errMsg || "Erreur"}
      </div>
    );
  }

  const issuer = (payload.issuer || {}) as Record<string, unknown>;
  const recipient = (payload.recipient || {}) as Record<string, unknown>;
  const lines = Array.isArray(payload.lines) ? (payload.lines as Record<string, unknown>[]) : [];
  const snapTotals = (payload.totals || {}) as Record<string, unknown>;
  const currency = (payload.currency as string) || "EUR";
  const live = liveTotals;
  const totals = {
    total_ht: live?.total_ht ?? Number(snapTotals.total_ht),
    total_vat: live?.total_vat ?? Number(snapTotals.total_vat),
    total_ttc: live?.total_ttc ?? Number(snapTotals.total_ttc),
    total_paid: live?.total_paid ?? Number(snapTotals.total_paid),
    total_credited: live?.total_credited ?? Number(snapTotals.total_credited),
    amount_due: live?.amount_due ?? Number(snapTotals.amount_due),
  };
  const issueDate = live?.issue_date ?? (payload.issue_date as string | null);
  const dueDate = live?.due_date ?? (payload.due_date as string | null);
  const payTerms = live?.payment_terms ?? (payload.payment_terms as string | null);
  const invStatus = live?.status ?? (payload.status as string | null);
  const sourceQuote = payload.source_quote as Record<string, unknown> | undefined;

  return (
    <div className="fi-root" id="pdf-root" style={{ "--fi-brand": brandColor } as React.CSSProperties}>
      <header className="fi-topbar">
        <div className="fi-logo-wrap">
          {logoUrl ? (
            <img src={logoUrl} alt="" onLoad={() => setLogoOk(true)} onError={() => setLogoOk(true)} />
          ) : (
            <span className="fi-brand-fallback">{String(issuer.display_name || "").trim() || "—"}</span>
          )}
        </div>
        <div className="fi-doc-head">
          <h1>FACTURE</h1>
          <span className="fi-status-pill">{statusLabel(invStatus)}</span>
        </div>
      </header>

      <section className="fi-columns">
        <div className="fi-block">
          <h2>Émetteur</h2>
          {buildIssuerLines(issuer, { includeBank: true }).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="fi-block">
          <h2>Facturation</h2>
          <p className="fi-recipient-name">{buildRecipientTitle(recipient)}</p>
          {buildRecipientLines(recipient).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </section>

      <div className="fi-meta">
        <div className="fi-meta-box">
          <dl style={{ margin: 0 }}>
            <dt>N° de facture</dt>
            <dd>{payload.number != null && payload.number !== "" ? String(payload.number) : "—"}</dd>
            <dt style={{ marginTop: 8 }}>Date d&apos;émission</dt>
            <dd>{formatDateFrLong(issueDate)}</dd>
          </dl>
        </div>
        <div className="fi-meta-box">
          <dl style={{ margin: 0 }}>
            <dt>Date d&apos;échéance</dt>
            <dd>{formatDateFrLong(dueDate)}</dd>
            <dt style={{ marginTop: 8 }}>Devise</dt>
            <dd>{currency}</dd>
          </dl>
        </div>
      </div>

      {sourceQuote?.quote_number ? (
        <p className="fi-ref-quote">
          Réf. devis : {String(sourceQuote.quote_number)}
          {sourceQuote.quote_id ? ` (${String(sourceQuote.quote_id).slice(0, 8)}…)` : null}
        </p>
      ) : null}

      <div className="fi-table-wrap">
        <table className="fi-table">
          <thead>
            <tr>
              <th>Désignation</th>
              <th className="fi-num">Qté</th>
              <th className="fi-num">PU HT</th>
              <th className="fi-num">TVA</th>
              <th className="fi-num">Total HT</th>
              <th className="fi-num">Total TTC</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((row, idx) => {
              const label = String(row.label ?? "—");
              const desc = row.description ? String(row.description) : "";
              return (
                <tr key={idx}>
                  <td>
                    <div className="fi-line-desc">
                      {label}
                      {desc ? <small>{desc}</small> : null}
                    </div>
                  </td>
                  <td className="fi-num">{row.quantity != null ? Number(row.quantity).toLocaleString("fr-FR") : "—"}</td>
                  <td className="fi-num">{formatEurUnknown(row.unit_price_ht)}</td>
                  <td className="fi-num">{formatVatRateDisplay(row.vat_rate)}</td>
                  <td className="fi-num">{formatEurUnknown(row.total_line_ht)}</td>
                  <td className="fi-num">{formatEurUnknown(row.total_line_ttc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fi-summary">
        <div className="fi-totals">
          <div className="fi-totals-row">
            <span>Total HT</span>
            <span>{formatEurUnknown(totals.total_ht)}</span>
          </div>
          <div className="fi-totals-row">
            <span>TVA</span>
            <span>{formatEurUnknown(totals.total_vat)}</span>
          </div>
          <div className="fi-totals-row">
            <span>Total TTC</span>
            <span>{formatEurUnknown(totals.total_ttc)}</span>
          </div>
          <div className="fi-totals-row">
            <span>Déjà réglé</span>
            <span>{formatEurUnknown(totals.total_paid)}</span>
          </div>
          {totals.total_credited > 0.0001 ? (
            <div className="fi-totals-row">
              <span>Avoirs imputés</span>
              <span>{formatEurUnknown(totals.total_credited)}</span>
            </div>
          ) : null}
          <div className="fi-totals-row fi-totals-row--due">
            <span>Reste à payer</span>
            <span>{formatEurUnknown(totals.amount_due)}</span>
          </div>
        </div>

        <div className="fi-pay-panel">
          <h3>Paiements enregistrés</h3>
          {payments.length === 0 ? (
            <p style={{ margin: 0, fontSize: "9pt", color: "var(--fi-muted)" }}>Aucun paiement pour l&apos;instant.</p>
          ) : (
            payments.map((p, i) => (
              <div key={i} className="fi-pay-row">
                <span>
                  {formatDateFrLong(p.payment_date)}
                  {p.payment_method ? ` · ${p.payment_method}` : ""}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span>{formatEurUnknown(p.amount)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {payTerms ? (
        <div className="fi-terms">
          <h3>Conditions de règlement</h3>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{payTerms}</p>
        </div>
      ) : null}

      {payload.notes ? (
        <div className="fi-terms">
          <h3>Notes</h3>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{String(payload.notes)}</p>
        </div>
      ) : null}

      {defaultInvoiceNotes ? (
        <div className="fi-terms">
          <h3>Conditions générales (émetteur)</h3>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{defaultInvoiceNotes}</p>
        </div>
      ) : null}

      <section className="fi-doc-contract" aria-label="Méthode documentaire">
        <p>
          <strong>Document mixte (figé + à jour)</strong> : les lignes et les montants HT/TTC reproduisent la facture
          telle qu&apos;émise. Les paiements listés, les avoirs imputés et le reste à payer reflètent l&apos;état
          comptable au moment de la génération de ce PDF.
        </p>
      </section>

      <LegalMentionsBlock />

      <div id="pdf-ready" data-status={status === "ready" ? "ready" : "pending"} aria-hidden="true" />
    </div>
  );
}
