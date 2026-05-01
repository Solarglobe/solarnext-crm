/**
 * PDF Facture client — Playwright.
 * Rendu strictement fidèle au snapshot officiel (lignes + totaux + statuts/dates figés à l’émission).
 * URL : financialInvoiceId, renderToken
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  buildInvoiceRecipientAddressLines,
  buildInvoiceRecipientContactLines,
  buildInvoiceRecipientIdentity,
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

export function sanitizeInvoicePdfCommercialText(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return raw
    .replace(/\s*[—-]\s*r[ée]f\.?\s*devis\s+[A-Z0-9._/\-]+/gi, "")
    .replace(/\s*r[ée]f\.?\s*devis\s+[A-Z0-9._/\-]+/gi, "")
    .replace(/\bdevis\b/gi, "facture")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
          defaultInvoiceNotes?: string | null;
          defaultInvoiceDueDays?: number;
        }) => {
          if (data?.ok === true && data.payload) {
            setPayload(data.payload);
            setOrganizationId(data.organizationId ?? null);
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

  const numSnap = (key: string): number => {
    const v = snapTotals[key];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const totals = {
    total_ht: numSnap("total_ht"),
    total_vat: numSnap("total_vat"),
    total_ttc: numSnap("total_ttc"),
    total_paid: numSnap("total_paid"),
    total_credited: numSnap("total_credited"),
    amount_due: numSnap("amount_due"),
  };
  const issueDate = payload.issue_date as string | null;
  const snapDue = payload.due_date as string | null | undefined;
  const displayDueDate = resolveInvoiceDueDateForPdf(null, snapDue, issueDate, defaultInvoiceDueDays);
  const payTerms = (payload.payment_terms as string | null) ?? null;
  const invStatus = payload.status as string | null;
  const refs = (payload.refs || {}) as Record<string, unknown>;
  const quoteBillingRole = String(refs.quote_billing_role ?? "").toUpperCase();
  const isDepositInvoice = quoteBillingRole === "DEPOSIT";
  const prepRefFromRefs = Number(refs.prepared_total_ttc_reference);
  let preparationServicesTtc: number | null = null;
  if (isDepositInvoice && Number.isFinite(prepRefFromRefs) && prepRefFromRefs > 0.0001) {
    preparationServicesTtc = prepRefFromRefs;
  }
  const depositPercentOfPreparation =
    isDepositInvoice &&
    preparationServicesTtc != null &&
    preparationServicesTtc > 0.0001 &&
    totals.total_ttc > 0
      ? Math.round(((totals.total_ttc / preparationServicesTtc) * 100 + Number.EPSILON) * 100) / 100
      : null;
  const depositAmountTtc = isDepositInvoice ? totals.total_ttc : null;
  const alreadyPaidTtc = isDepositInvoice ? totals.total_paid : null;
  const remainingProjectTtc =
    isDepositInvoice &&
    preparationServicesTtc != null &&
    depositAmountTtc != null &&
    alreadyPaidTtc != null
      ? Math.max(
          0,
          Math.round((preparationServicesTtc - depositAmountTtc - alreadyPaidTtc + Number.EPSILON) * 100) / 100
        )
      : null;
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
          <h1 className="fi-invoice-h1">{isDepositInvoice ? "FACTURE D'ACOMPTE" : "FACTURE"}</h1>
          <span className="fi-status-pill">{statusLabel(invStatus)}</span>
        </div>
        <div className="fi-meta-grid">
          <div className="fi-meta-field">
            <span className="fi-meta-k">N° de facture</span>
            <span className="fi-meta-v">{invoiceNumberDisplay}</span>
          </div>
          <div className="fi-meta-field">
            <span className="fi-meta-k">Monnaie</span>
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
                const label = sanitizeInvoicePdfCommercialText(row.label ?? "—") || "—";
                const desc = row.description ? sanitizeInvoicePdfCommercialText(row.description) : "";
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
          {isDepositInvoice && preparationServicesTtc != null ? (
            <>
              <div className="fi-totals-row">
                <span>Montant total des prestations</span>
                <span>{formatEurUnknown(preparationServicesTtc)}</span>
              </div>
              {depositAmountTtc != null ? (
                <div className="fi-totals-row">
                  <span>Acompte facturé</span>
                  <span>{formatEurUnknown(depositAmountTtc)}</span>
                </div>
              ) : null}
              {depositPercentOfPreparation != null ? (
                <p style={{ margin: "4px 0 10px", fontSize: 11, color: "var(--fi-text-muted, #64748b)" }}>
                  Soit{" "}
                  {depositPercentOfPreparation.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  % du montant total des prestations.
                </p>
              ) : null}
            </>
          ) : null}
          {isDepositInvoice && alreadyPaidTtc != null && alreadyPaidTtc > 0.0001 ? (
            <div className="fi-totals-row">
              <span>Total déjà versé TTC</span>
              <span>{formatEurUnknown(alreadyPaidTtc)}</span>
            </div>
          ) : null}
          {isDepositInvoice && remainingProjectTtc != null ? (
            <div className="fi-totals-row">
              <span>Reste sur prestations (après acompte et paiements)</span>
              <span>{formatEurUnknown(remainingProjectTtc)}</span>
            </div>
          ) : null}
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
          <strong>Document figé</strong> : lignes, montants et états financiers (y compris déjà réglé et reste à payer)
          correspondent au snapshot officiel de la facture au moment de son émission ou de sa dernière régénération du
          snapshot.
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
