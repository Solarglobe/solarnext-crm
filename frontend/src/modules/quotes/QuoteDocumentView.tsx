/**
 * Rendu devis unique — PDF Playwright + page Présenter (même DOM / CSS, A4).
 */

import React from "react";
import {
  buildIssuerLines,
  buildRecipientLines,
  formatDateFrLong,
  formatEurLeading,
  formatEurUnknown,
  formatTvaRowLabelFromTotals,
  formatTodayFrNumeric,
  quoteValidityHintFr,
} from "../../pages/pdf/financialPdfFormat";
import type { QuotePdfPayload, QuoteSignatureReadAcceptance } from "./quoteDocumentTypes";
import PdfCgvSection from "../../pages/pdf/PdfLegacyPort/PdfCgvSection";
import { QUOTE_PDF_WORK_NUMBER_LABEL } from "./quoteUiStatus";
import "../../pages/pdf/financial-quote-pdf.css";

export type QuoteDocumentLegalMode = "official" | "draft";
export type QuoteDocumentVariant = "standard" | "signed_final";

function formatSignatureReadAckLine(ack: QuoteSignatureReadAcceptance | null | undefined): string | null {
  if (!ack || ack.accepted !== true) return null;
  const label = (ack.acceptedLabel && String(ack.acceptedLabel).trim()) || "Lu et accepté";
  const officialIso = (ack.signedAtServer && String(ack.signedAtServer).trim()) || (ack.recordedAt && String(ack.recordedAt).trim()) || "";
  if (officialIso) {
    const d = formatDateFrLong(officialIso);
    if (d && d !== "—") return `${label} — ${d}`;
  }
  return label;
}

export interface QuoteDocumentViewProps {
  payload: QuotePdfPayload;
  variant: "pdf" | "present";
  legalMode: QuoteDocumentLegalMode;
  documentVariant?: QuoteDocumentVariant;
  brandColor: string;
  logoSrc: string | null;
  issuerFallbackName: string;
  onLogoLoad?: () => void;
  onLogoError?: () => void;
  interactiveSignatures?: boolean;
  signatureClientImage?: string | null;
  signatureCompanyImage?: string | null;
  onSignatureClientImageLoad?: () => void;
  onSignatureCompanyImageLoad?: () => void;
  onSignatureClientImageError?: () => void;
  onSignatureCompanyImageError?: () => void;
  onSignatureClientClick?: () => void;
  onSignatureCompanyClick?: () => void;
  /** Case « lu et approuvé » — Présenter : contrôlée par le parent ; PDF : affichage seul */
  clientReadApproved?: boolean;
  onClientReadApprovedChange?: (checked: boolean) => void;
  pdfRootId?: string;
  pdfReadyMarker?: boolean;
  /**
   * false = document de travail / présentation : pas de numéro officiel ni mentions « offre figée à l’envoi ».
   * @default true
   */
  showOfficialQuoteNumber?: boolean;
}

function SignatureBlock({
  label,
  interactive,
  imageSrc,
  onImageLoad,
  onImageError,
  onClick,
  emptyHint,
  openPadAriaLabel,
  readAckLine,
}: {
  label: string;
  interactive?: boolean;
  imageSrc?: string | null;
  onImageLoad?: () => void;
  onImageError?: () => void;
  onClick?: () => void;
  emptyHint: string;
  /** Libellé du bouton zone signature (modal agrandie) */
  openPadAriaLabel?: string;
  /** Mention « lu et accepté » sous le cadre (PDF signé / payload enrichi) */
  readAckLine?: string | null;
}) {
  const areaContent = (
    <>
      {imageSrc ? (
        <img src={imageSrc} alt="" onLoad={onImageLoad} onError={onImageError} draggable={false} />
      ) : (
        <span className="fq-signature-placeholder">{emptyHint}</span>
      )}
    </>
  );

  return (
    <div className={`fq-signature-box fq-signature-box--sign${interactive ? " fq-signature-box--interactive" : ""}`}>
      <strong>{label}</strong>
      {interactive ? (
        <button
          type="button"
          className="fq-signature-canvas-area fq-signature-touch-target"
          aria-label={openPadAriaLabel || `Ouvrir la zone de signature agrandie — ${label}`}
          onClick={() => onClick?.()}
        >
          {areaContent}
        </button>
      ) : (
        <div className="fq-signature-canvas-area">{areaContent}</div>
      )}
      {readAckLine ? (
        <p className="fq-signature-read-ack" role="note">
          {readAckLine}
        </p>
      ) : null}
    </div>
  );
}

export function QuoteDocumentView({
  payload,
  variant,
  legalMode,
  documentVariant = "standard",
  brandColor,
  logoSrc,
  issuerFallbackName,
  onLogoLoad,
  onLogoError,
  interactiveSignatures = false,
  signatureClientImage = null,
  signatureCompanyImage = null,
  onSignatureClientImageLoad,
  onSignatureCompanyImageLoad,
  onSignatureClientImageError,
  onSignatureCompanyImageError,
  onSignatureClientClick,
  onSignatureCompanyClick,
  clientReadApproved = false,
  onClientReadApprovedChange,
  pdfRootId = "financial-quote-pdf-root",
  pdfReadyMarker = false,
  showOfficialQuoteNumber = true,
}: QuoteDocumentViewProps) {
  const issuer = (payload.issuer || {}) as Record<string, unknown>;
  const recipient = (payload.recipient || {}) as Record<string, unknown>;
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const totals = (payload.totals || {}) as Record<string, unknown>;
  const currency = (payload.currency as string) || "EUR";
  const showLinePricing = payload.pdf_display?.show_line_pricing !== false;

  const companyName = String(issuer.display_name || issuer.legal_name || issuer.trade_name || "").trim() || "—";

  const showOfficial = showOfficialQuoteNumber !== false;
  const docNumberDisplayed = showOfficial ? (payload.number?.trim() || "—") : QUOTE_PDF_WORK_NUMBER_LABEL;

  const legalFootnote = !showOfficial
    ? "Document de présentation — sans valeur contractuelle définitive tant que le devis n’est pas signé."
    : legalMode === "draft"
      ? "Proposition commerciale — le contenu peut encore évoluer avant signature du devis."
      : documentVariant === "signed_final"
        ? "Document signé — reproduction avec signatures client et entreprise. Référence contractuelle après validation."
        : "Document officiel — offre arrêtée ; engagement définitif sous réserve de signature des parties.";

  const accordIntro = !showOfficial
    ? "Ce document présente une proposition commerciale. L’engagement définitif résulte de la signature des parties ci-dessous."
    : "Le présent document vaut engagement contractuel dès signature. La signature électronique a la même valeur qu'une signature manuscrite, y compris au sens du règlement eIDAS lorsque les conditions d'usage sont réunies. Le client reconnaît avoir pris connaissance de l'offre et des conditions qui s'y attachent.";

  const clientLines = buildRecipientLines(recipient);
  const issuerLines = buildIssuerLines(issuer, { includeBank: false, compactQuotePdf: true });

  const regRaw = payload.regulatory_document_text?.trim();
  const regulatoryParagraphs = regRaw
    ? regRaw
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  const hasAnnexes =
    Boolean(payload.commercial_notes?.trim()) ||
    Boolean(payload.technical_notes?.trim()) ||
    Boolean(payload.notes?.trim());

  const hasPaymentBlock = Boolean(payload.deposit_display) || Boolean(payload.payment_terms?.trim());

  const tvaLabel = formatTvaRowLabelFromTotals(totals.total_ht, totals.total_vat);
  const todayFr = formatTodayFrNumeric();
  const showApprovalBlock =
    legalMode === "official" || (variant === "present" && legalMode === "draft");
  const approvalInteractive = Boolean(onClientReadApprovedChange);

  const showSigReadAck = documentVariant === "signed_final";
  const clientSigAckLine = showSigReadAck ? formatSignatureReadAckLine(payload.signature_client_read_acceptance) : null;
  const companySigAckLine = showSigReadAck ? formatSignatureReadAckLine(payload.signature_company_read_acceptance) : null;

  const lineTbodies = (condensed: boolean) =>
    lines.map((row, idx) => {
      const isLast = idx === lines.length - 1;
      const label = condensed
        ? String(row.label ?? "—").trim() || "—"
        : String(row.label ?? "—");
      const refRaw = row.reference != null ? String(row.reference).trim() : "";
      const descRaw = row.description != null ? String(row.description).trim() : "";
      const desc = !condensed && row.description ? String(row.description) : "";

      return (
        <tbody
          key={idx}
          className={`fq-line-group${isLast ? " fq-line-group--last" : ""}`}
        >
          {condensed ? (
            <tr>
              <td className="fq-condensed-cell">
                <div className="fq-condensed-title">{label}</div>
                {refRaw ? <div className="fq-condensed-ref">Réf. {refRaw}</div> : null}
                {descRaw ? <div className="fq-condensed-desc">{descRaw}</div> : null}
              </td>
            </tr>
          ) : (
            <tr>
              <td>
                <div className="fq-line-desc">
                  {label}
                  {desc ? <div className="fq-line-desc-body">{desc}</div> : null}
                </div>
              </td>
              <td className="fq-center">
                {row.quantity != null ? Number(row.quantity).toLocaleString("fr-FR") : "—"}
              </td>
              <td className="fq-num">{formatEurLeading(row.unit_price_ht)}</td>
              <td className="fq-num">{formatEurLeading(row.total_line_ht)}</td>
            </tr>
          )}
        </tbody>
      );
    });

  return (
    <div
      className="fq-root"
      id={variant === "pdf" ? pdfRootId : undefined}
      style={{ "--fq-accent": brandColor } as React.CSSProperties}
    >
      <div className="fq-doc">
        <section className="fq-section fq-section--main" aria-label={"En-tête et détail de l'offre"}>
          <div className="fq-devis-dochead-block">
            <header className="fq-erp-toprow">
              <div className="fq-erp-dochead fq-erp-dochead--left">
                <h1 className={`fq-erp-devis-title${showOfficial ? "" : " fq-erp-devis-title--presentation"}`}>DEVIS</h1>
                <div className="fq-erp-docmeta">
                  <p className="fq-erp-docmeta-line">
                    <strong>N°</strong> {docNumberDisplayed}
                  </p>
                  <p className="fq-erp-docmeta-line">
                    <strong>Date</strong> {formatDateFrLong(payload.sent_at)}
                  </p>
                  <p className="fq-erp-docmeta-line">
                    <strong>Valable jusqu&apos;au</strong> {formatDateFrLong(payload.valid_until)}
                  </p>
                </div>
              </div>
              <div className="fq-erp-logo fq-erp-logo--right">
                {logoSrc ? (
                  <img src={logoSrc} alt="" onLoad={onLogoLoad} onError={onLogoError} />
                ) : (
                  <span className="fq-brand-fallback">{issuerFallbackName}</span>
                )}
              </div>
            </header>
            <div className="fq-erp-rule" role="presentation" />

            <div className="fq-erp-identity">
              <div>
                <p className="fq-erp-col-label">Client</p>
                <div className="fq-erp-col-body">
                  {clientLines.length ? (
                    clientLines.map((line, i) => (
                      <p key={i} className={i === 0 ? "fq-erp-primary-line" : undefined}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p>—</p>
                  )}
                </div>
              </div>
              <div className="fq-erp-col fq-erp-col--issuer">
                <p className="fq-erp-col-label">Entreprise</p>
                <div className="fq-erp-col-body">
                  {companyName || issuerLines.length ? (
                    <>
                      {companyName ? (
                        <p className="fq-erp-primary-line">{companyName}</p>
                      ) : null}
                      {issuerLines.map((line, i) => (
                        <p key={i} className={!companyName && i === 0 ? "fq-erp-primary-line" : undefined}>
                          {line}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p>—</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <h2 className="fq-erp-offer-title">Détail de l&apos;offre</h2>

          {showLinePricing ? (
            <div className="fq-table-wrap">
              <table className="fq-table">
                <thead>
                  <tr>
                    <th>Nom et description</th>
                    <th className="fq-center">Qté</th>
                    <th className="fq-num">PU HT</th>
                    <th className="fq-num">Total HT</th>
                  </tr>
                </thead>
                {lineTbodies(false)}
              </table>
            </div>
          ) : (
            <div className="fq-table-wrap fq-table-wrap--condensed">
              <p className="fq-condensed-hint">Présentation condensée — montants détaillés sous le tableau.</p>
              <table className="fq-table fq-table--condensed">
                <thead>
                  <tr>
                    <th>Nom et description</th>
                  </tr>
                </thead>
                {lineTbodies(true)}
              </table>
            </div>
          )}
        </section>

        <section className="fq-section fq-section--legal" aria-label="Mentions, totaux et engagement">
          {/* Réglementaire + totaux + annexes + paiement + signatures : même bloc pagination (ne pas séparer) */}
          <div className="fq-devis-pricing-signature-bundle">
            <div className="fq-devis-regulatory-block">
              <section className="fq-regulatory-callout" aria-labelledby="fq-reg-title">
                <h3 id="fq-reg-title">Informations réglementaires &amp; conformité</h3>
                {regulatoryParagraphs.length ? (
                  regulatoryParagraphs.map((para, i) => <p key={i}>{para}</p>)
                ) : (
                  <p className="fq-regulatory-placeholder">
                    Texte à définir dans Organisation → Catalogue devis → Document PDF.
                  </p>
                )}
                <p className="fq-frozen-hint" role="note">
                  {legalFootnote}
                </p>
                <p className="fq-legal">{quoteValidityHintFr(payload.sent_at, payload.valid_until)}</p>
              </section>
            </div>

            <div className="fq-totals">
              <div className="fq-totals-inner">
                <div className="fq-totals-row">
                  <span>Total HT</span>
                  <span>{formatEurLeading(totals.total_ht)}</span>
                </div>
                {Number(totals.discount_ht) > 0.0001 ? (
                  <div className="fq-totals-row">
                    <span>Remise</span>
                    <span>− {formatEurLeading(totals.discount_ht)}</span>
                  </div>
                ) : null}
                <div className="fq-totals-row">
                  <span>{tvaLabel}</span>
                  <span>{formatEurLeading(totals.total_vat)}</span>
                </div>
                <div className="fq-totals-row fq-totals-row--sep fq-totals-row--emph">
                  <span>Total TTC ({currency})</span>
                  <span>{formatEurLeading(totals.total_ttc)}</span>
                </div>
              </div>
            </div>

            {hasAnnexes ? (
              <div className="fq-quote-annexes">
                {payload.commercial_notes ? (
                  <p>
                    <strong>Mentions commerciales — </strong>
                    {payload.commercial_notes}
                  </p>
                ) : null}
                {payload.technical_notes ? (
                  <p>
                    <strong>Précisions techniques — </strong>
                    {payload.technical_notes}
                  </p>
                ) : null}
                {payload.notes ? (
                  <p>
                    <strong>Notes — </strong>
                    {payload.notes}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="fq-payment-sign-flow">
              {hasPaymentBlock ? (
                <section className="fq-payment-section" aria-labelledby="fq-pay-title">
                  <h3 id="fq-pay-title" className="fq-erp-gold-heading">
                    Modalités de paiement
                  </h3>
                  <div className="fq-payment-body">
                    {payload.deposit_display ? (
                      <div className="fq-deposit">
                        {String(payload.deposit_display.mode || "").toUpperCase() === "PERCENT" ? (
                          <p>
                            Acompte : {Number(payload.deposit_display.percent ?? 0).toLocaleString("fr-FR")} % du TTC
                            {payload.deposit_display.amount_ttc != null ? (
                              <> (soit {formatEurUnknown(payload.deposit_display.amount_ttc)} TTC)</>
                            ) : null}
                          </p>
                        ) : (
                          <p>Acompte : {formatEurUnknown(payload.deposit_display.amount_ttc)} TTC</p>
                        )}
                        {payload.deposit_display.note ? (
                          <p className="fq-deposit-note">{payload.deposit_display.note}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {payload.payment_terms ? <p>{payload.payment_terms}</p> : null}
                  </div>
                </section>
              ) : null}

              <div className="fq-sign-section-wrap">
                <section className="fq-signature-erp" aria-labelledby="fq-accord-title">
                  <h3 id="fq-accord-title">Bon pour accord</h3>
                  <p className="fq-accord-intro">{accordIntro}</p>
                  {showApprovalBlock ? (
                    <div className="fq-client-approval-block">
                      <label
                        className={`fq-client-approval-label${approvalInteractive ? "" : " fq-client-approval-label--static"}`}
                      >
                        {approvalInteractive ? (
                          <input
                            type="checkbox"
                            checked={clientReadApproved}
                            onChange={(e) => onClientReadApprovedChange?.(e.target.checked)}
                            className="fq-client-approval-checkbox"
                          />
                        ) : (
                          <span className="fq-client-approval-faux-cb" aria-hidden="true">
                            {clientReadApproved ? "☑" : "☐"}
                          </span>
                        )}
                        <span className="fq-client-approval-text">
                          <span className="fq-client-approval-title">Bon pour accord</span>
                          <span className="fq-client-approval-sub">
                            Le client certifie avoir lu le présent devis et l&apos;approuve sans réserve.
                          </span>
                        </span>
                      </label>
                      <p className="fq-signature-date-today">
                        <strong>Date :</strong> {todayFr}
                      </p>
                      {variant === "present" && legalMode === "draft" ? (
                        <p className="fq-approval-draft-hint">
                          Après validation, le devis signé est enregistré et le numéro officiel devient visible sur le document
                          définitif.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="fq-signature-grid">
                    <SignatureBlock
                      label="Signature du client"
                      interactive={interactiveSignatures}
                      imageSrc={signatureClientImage}
                      onImageLoad={onSignatureClientImageLoad}
                      onImageError={onSignatureClientImageError}
                      onClick={onSignatureClientClick}
                      emptyHint={interactiveSignatures ? "Cliquer pour ouvrir la signature" : " "}
                      openPadAriaLabel="Ouvrir la zone de signature agrandie — signature client"
                      readAckLine={clientSigAckLine}
                    />
                    <SignatureBlock
                      label={`Signature / cachet — ${companyName}`}
                      interactive={interactiveSignatures}
                      imageSrc={signatureCompanyImage}
                      onImageLoad={onSignatureCompanyImageLoad}
                      onImageError={onSignatureCompanyImageError}
                      onClick={onSignatureCompanyClick}
                      emptyHint={interactiveSignatures ? "Cliquer pour ouvrir la signature" : " "}
                      openPadAriaLabel="Ouvrir la zone de signature agrandie — signature entreprise"
                      readAckLine={companySigAckLine}
                    />
                  </div>
                  {variant === "present" && interactiveSignatures ? (
                    <div className="fq-sign-dates fq-sign-dates--present-hint" aria-hidden="true">
                      <span className="fq-sign-dates-hint">
                        Signez dans les cadres ci-dessus (doigt, stylet ou souris).
                      </span>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </div>
        </section>
      </div>

      <PdfCgvSection legalCgv={payload.legal_cgv} />

      {variant === "pdf" ? (
        <div id="pdf-ready" data-status={pdfReadyMarker ? "ready" : "pending"} aria-hidden="true" />
      ) : null}
    </div>
  );
}
