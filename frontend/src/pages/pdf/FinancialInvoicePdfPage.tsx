/**
 * PDF Facture client — Playwright.
 * Lignes : snapshot d’émission. Totaux / solde / paiements : état live au moment de la génération (cf. section « Document mixte »).
 * URL : financialInvoiceId, renderToken
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  buildInvoiceRecipientAddressLines,
  buildInvoiceRecipientContactLines,
  buildInvoiceRecipientIdentity,
  formatDateFrLong,
  formatDateFrSlash,
  formatEurUnknown,
  formatVatRateDisplay,
  invoiceRecipientHasAddressLines,
  resolveInvoiceDueDateForPdf,
} from "./financialPdfFormat";
import "./financial-invoice-pdf.css";
import { resolvePdfPrimaryColor } from "./pdfBrand";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();

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
    <section className="fi-no-break fi-section fi-section--legal fi-legal">
      <h3 className="fi-section-title">Mentions légales</h3>
      <p>
        En cas de retard de paiement, des pénalités de retard au taux légal en vigueur pourront être appliquées, ainsi
        qu&apos;une indemnité forfaitaire pour frais de recouvrement de 40 € pour les professionnels, conformément aux
        articles L.441-6 et D.441-5 du Code de commerce lorsque les conditions légales sont réunies.
      </p>
      <p className="fi-legal-gap">
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
  const [defaultInvoiceDueDays, setDefaultInvoiceDueDays] = useState<number>(30);
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
      .then(
        (data: {
          ok?: boolean;
          payload?: Record<string, unknown>;
          organizationId?: string;
          liveTotals?: LiveTotals;
          payments?: PaymentRow[];
          defaultInvoiceNotes?: string | null;
          defaultInvoiceDueDays?: number;
        }) => {
          if (data?.ok === true && data.payload) {
            setPayload(data.payload);
            setOrganizationId(data.organizationId ?? null);
            setLiveTotals(data.liveTotals ?? null);
            setPayments(Array.isArray(data.payments) ? data.payments : []);
            setDefaultInvoiceNotes(data.defaultInvoiceNotes ?? null);
            const d = data.defaultInvoiceDueDays;
            setDefaultInvoiceDueDays(d != null && Number.isFinite(Number(d)) ? Number(d) : 30);
            setStatus("ready");
          } else {
            throw new Error("Réponse invalide");
          }
        }
      )
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
  const identity = buildInvoiceRecipientIdentity(recipient);
  const hasAddr = invoiceRecipientHasAddressLines(recipient);
  const addressLines = buildInvoiceRecipientAddressLines(recipient);
  const contactLines = buildInvoiceRecipientContactLines(recipient);

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
  const snapDue = payload.due_date as string | null | undefined;
  const liveDue = live?.due_date ?? null;
  const displayDueDate = resolveInvoiceDueDateForPdf(liveDue, snapDue, issueDate, defaultInvoiceDueDays);
  const payTerms = live?.payment_terms ?? (payload.payment_terms as string | null);
  const invStatus = live?.status ?? (payload.status as string | null);
  const sourceQuote = payload.source_quote as Record<string, unknown> | undefined;
  const invoiceNumberDisplay = payload.number != null && payload.number !== "" ? String(payload.number) : "—";
  const issuerAddress = (issuer.address as Record<string, unknown> | undefined) ?? {};
  const issuerDisplayName = String(
    issuer.display_name || issuer.legal_name || issuer.trade_name || ""
  ).trim();
  const issuerStreet = [issuerAddress.line1, issuerAddress.line2].filter(Boolean).join(", ").trim();
  const issuerCityLine = [issuerAddress.postal_code, issuerAddress.city].filter(Boolean).join(" ").trim();
  const issuerCountry = issuerAddress.country ? String(issuerAddress.country).trim() : "";
  const issuerEmail = issuer.email ? String(issuer.email).trim() : "";
  const issuerPhone = issuer.phone ? String(issuer.phone).trim() : "";
  const issuerBank = ((issuer.bank as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const legalBankPairs = [
    { label: "SIRET", value: issuer.siret },
    { label: "TVA", value: issuer.vat_number },
    { label: "RCS", value: issuer.rcs },
    { label: "Banque", value: issuerBank.bank_name },
    { label: "IBAN", value: issuerBank.iban },
    { label: "BIC", value: issuerBank.bic },
  ].map((x) => ({ label: x.label, value: x.value ? String(x.value).trim() : "" }));

  return (
    <div className="fi-root" id="pdf-root" style={{ "--fi-brand": brandColor } as React.CSSProperties}>
      {/* 1. Header entreprise */}
      <header className="fi-no-break fi-section fi-section--org">
        <div className="fi-org-header-inner">
          <div className="fi-logo-wrap">
            {logoUrl ? (
              <img src={logoUrl} alt="" onLoad={() => setLogoOk(true)} onError={() => setLogoOk(true)} />
            ) : null}
          </div>
          <div className="fi-org-lines">
            <div className="fi-org-grid">
              <div className="fi-org-grid-col">
                <p className="fi-col-label">Émetteur</p>
                <p className="fi-org-company">{issuerDisplayName || "—"}</p>
                {issuerEmail ? <p>{issuerEmail}</p> : null}
                {issuerPhone ? <p>{issuerPhone}</p> : null}
              </div>
              <div className="fi-org-grid-col">
                <p className="fi-col-label">Siège</p>
                {issuerStreet ? <p>{issuerStreet}</p> : null}
                {issuerCityLine ? <p>{issuerCityLine}</p> : null}
                {issuerCountry ? <p>{issuerCountry}</p> : null}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Bloc client */}
      <section className="fi-no-break fi-section fi-section--client">
        <h2 className="fi-block-label">Facturé à</h2>
        <div className="fi-recipient-stack">
          <p className="fi-recipient-primary">{identity.primary}</p>
          {identity.secondary ? <p className="fi-recipient-secondary">{identity.secondary}</p> : null}
          {addressLines.map((line, i) => (
            <p key={`a-${i}`} className="fi-recipient-line">
              {line}
            </p>
          ))}
          {!hasAddr ? <p className="fi-recipient-fallback">Adresse non renseignée</p> : null}
          {contactLines.length > 0 ? (
            <div className="fi-recipient-contact">
              {contactLines.map((line, i) => (
                <p key={`c-${i}`} className="fi-recipient-line">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* 3. Infos facture */}
      <section className="fi-no-break fi-section fi-section--invoice-meta">
        <div className="fi-invoice-title-row">
          <h1 className="fi-invoice-h1">FACTURE</h1>
          <span className="fi-status-pill">{statusLabel(invStatus)}</span>
        </div>
        <div className="fi-meta-grid">
          <div className="fi-meta-field">
            <span className="fi-meta-k">N° de facture</span>
            <span className="fi-meta-v">{invoiceNumberDisplay}</span>
          </div>
          <div className="fi-meta-field">
            <span className="fi-meta-k">Devise</span>
            <span className="fi-meta-v">{currency}</span>
          </div>
          <div className="fi-meta-field">
            <span className="fi-meta-k">Date d&apos;émission</span>
            <span className="fi-meta-v">{formatDateFrSlash(issueDate)}</span>
          </div>
          <div className="fi-meta-field">
            <span className="fi-meta-k">Date d&apos;échéance</span>
            <span className="fi-meta-v">{formatDateFrSlash(displayDueDate)}</span>
          </div>
        </div>
        {sourceQuote?.quote_number ? (
          <p className="fi-ref-quote">Réf. devis : {String(sourceQuote.quote_number)}</p>
        ) : null}
      </section>

      {/* 4. Tableau lignes */}
      <section className="fi-section fi-section--lines">
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
                  <tr key={idx} className="fi-tr-line">
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
      </section>

      {/* 5. Totaux */}
      <section className="fi-no-break fi-section fi-section--totals">
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
      </section>

      {/* 6. Paiements */}
      <section className="fi-no-break fi-section fi-section--payments">
        <div className="fi-pay-panel">
          <h3 className="fi-subtitle">Paiements enregistrés</h3>
          {payments.length === 0 ? (
            <p className="fi-pay-empty">Aucun paiement pour l&apos;instant.</p>
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
      </section>

      {payTerms ? (
        <div className="fi-no-break fi-section fi-terms">
          <h3 className="fi-subtitle">Conditions de règlement</h3>
          <p className="fi-pre">{payTerms}</p>
        </div>
      ) : null}

      {payload.notes ? (
        <div className="fi-no-break fi-section fi-terms">
          <h3 className="fi-subtitle">Notes</h3>
          <p className="fi-pre">{String(payload.notes)}</p>
        </div>
      ) : null}

      {defaultInvoiceNotes ? (
        <div className="fi-no-break fi-section fi-terms">
          <h3 className="fi-subtitle">Conditions générales (émetteur)</h3>
          <p className="fi-pre">{defaultInvoiceNotes}</p>
        </div>
      ) : null}

      <section className="fi-no-break fi-doc-contract" aria-label="Méthode documentaire">
        <p>
          <strong>Document mixte (figé + à jour)</strong> : les lignes et les montants HT/TTC reproduisent la facture
          telle qu&apos;émise. Les paiements listés, les avoirs imputés et le reste à payer reflètent l&apos;état
          comptable au moment de la génération de ce PDF.
        </p>
      </section>

      <section className="fi-no-break fi-section fi-legal-bank">
        <h3 className="fi-subtitle">Mentions légales &amp; bancaires</h3>
        <div className="fi-legal-bank-grid">
          <div className="fi-legal-bank-col">
            {legalBankPairs.slice(0, 3).map((item) => (
              <p key={item.label} className="fi-legal-bank-row">
                <span>{item.label} :</span>
                <span>{item.value || "—"}</span>
              </p>
            ))}
          </div>
          <div className="fi-legal-bank-col">
            {legalBankPairs.slice(3).map((item) => (
              <p key={item.label} className="fi-legal-bank-row">
                <span>{item.label} :</span>
                <span>{item.value || "—"}</span>
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Mentions légales */}
      <LegalMentionsBlock />

      <div id="pdf-ready" data-status={status === "ready" ? "ready" : "pending"} aria-hidden="true" />
    </div>
  );
}
