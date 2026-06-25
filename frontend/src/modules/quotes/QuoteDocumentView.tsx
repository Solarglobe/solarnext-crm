/**
 * Rendu devis unique — PDF Playwright + page Présenter (même DOM / CSS, A4).
 * Signatures interactives : verrouillées tant que prérequis (accord + CGV + identité) non remplis.
 */

import React from "react";
import {
  buildIssuerLines,
  buildRecipientLines,
  formatDateFrLong,
  formatEurLeading,
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
  /** Présenter : message affiché dans le cadre quand la signature est verrouillée (prérequis non remplis). */
  signatureLockedHint?: string | null;
  /** Case « lu et approuvé » — Présenter : contrôlée par le parent ; PDF : affichage seul */
  clientReadApproved?: boolean;
  onClientReadApprovedChange?: (checked: boolean) => void;
  /** Demande expresse d'exécution anticipée (L221-25) — optionnelle ; Présenter : contrôlée par le parent, PDF : affichage seul */
  expressExecutionRequested?: boolean;
  onExpressExecutionRequestedChange?: (checked: boolean) => void;
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
  signatureLockedHint = null,
  clientReadApproved = false,
  onClientReadApprovedChange,
  expressExecutionRequested = false,
  onExpressExecutionRequestedChange,
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

  /**
   * Séparation A/B/C : lignes SolarGlobe (facturables) vs lignes pose installateur RGE (indicatif).
   * total_* = SolarGlobe (Stage 1) ; les blocs B/C viennent du payload, avec repli calculé
   * sur les lignes pour les anciens snapshots dépourvus de ces blocs.
   */
  const isInstallerLine = (row: Record<string, unknown>) =>
    String(row?.billing_party ?? "").trim().toUpperCase() === "INSTALLER_RGE";
  const solarglobeLines = lines.filter((r) => !isInstallerLine(r));
  const installerLines = lines.filter(isInstallerLine);
  const hasInstaller = installerLines.length > 0;
  const sumLines = (arr: Array<Record<string, unknown>>, key: string) =>
    arr.reduce((s, r) => s + (Number(r?.[key]) || 0), 0);
  const num2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
  const installerTotals = (payload.installer_totals as Record<string, unknown> | null) ?? {
    total_ht: num2(sumLines(installerLines, "total_line_ht")),
    total_vat: num2(sumLines(installerLines, "total_line_vat")),
    total_ttc: num2(sumLines(installerLines, "total_line_ttc")),
  };
  const projectIndicativeTotals = (payload.project_indicative_totals as Record<string, unknown> | null) ?? {
    total_ht: num2((Number(totals.total_ht) || 0) + (Number(installerTotals.total_ht) || 0)),
    total_vat: num2((Number(totals.total_vat) || 0) + (Number(installerTotals.total_vat) || 0)),
    total_ttc: num2((Number(totals.total_ttc) || 0) + (Number(installerTotals.total_ttc) || 0)),
  };
  const installerTvaLabel = formatTvaRowLabelFromTotals(installerTotals.total_ht, installerTotals.total_vat);

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
  /**
   * Échéancier SolarGlobe — calculé UNIQUEMENT sur le total SolarGlobe TTC (section A = payload.totals.total_ttc),
   * jamais sur le coût global indicatif (section C). Affichage uniquement ; aucun calcul de total modifié.
   * Acompte : repris du dépôt figé (déjà calculé sur la section A) s'il existe, sinon 50 % par défaut.
   */
  const sgTtcPay = Number(totals.total_ttc) || 0;
  const ddPay = payload.deposit_display;
  const acompteTtcPay =
    ddPay && ddPay.amount_ttc != null ? Number(ddPay.amount_ttc) : Math.round(sgTtcPay * 0.5 * 100) / 100;
  const acomptePctPay =
    ddPay && String(ddPay.mode || "").toUpperCase() === "PERCENT" && ddPay.percent != null
      ? Number(ddPay.percent)
      : sgTtcPay > 0
        ? Math.round((acompteTtcPay / sgTtcPay) * 100)
        : 50;
  const soldePctPay = Math.max(0, 100 - acomptePctPay);
  const soldeTtcPay = Math.round((sgTtcPay - acompteTtcPay) * 100) / 100;
  const totalDiscountFromLines = solarglobeLines.reduce((sum, row) => {
    const kind = String(row.line_kind ?? "").trim().toUpperCase();
    if (kind !== "DOCUMENT_DISCOUNT") return sum;
    const lineHt = Number(row.total_line_ht);
    if (!Number.isFinite(lineHt) || lineHt >= 0) return sum;
    return sum + Math.abs(lineHt);
  }, 0);

  const tvaLabel = formatTvaRowLabelFromTotals(totals.total_ht, totals.total_vat);
  const todayFr = formatTodayFrNumeric();
  const showApprovalBlock =
    legalMode === "official" || (variant === "present" && legalMode === "draft");
  const approvalInteractive = Boolean(onClientReadApprovedChange);
  /** Demande expresse d'exécution anticipée : interactive en mode Présenter ; sinon affichage de l'état enregistré. */
  const expressInteractive = Boolean(onExpressExecutionRequestedChange);
  const expressChecked = expressInteractive
    ? Boolean(expressExecutionRequested)
    : payload.express_execution_acceptance?.accepted === true || Boolean(expressExecutionRequested);

  const showSigReadAck = documentVariant === "signed_final";
  const clientSigAckLine = showSigReadAck ? formatSignatureReadAckLine(payload.signature_client_read_acceptance) : null;
  const companySigAckLine = showSigReadAck ? formatSignatureReadAckLine(payload.signature_company_read_acceptance) : null;

  const lineTbodies = (condensed: boolean) =>
    solarglobeLines.map((row, idx) => {
      const isLast = idx === solarglobeLines.length - 1;
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

          <h2 className="fq-erp-offer-title">
            {hasInstaller ? "A — Prestations SolarGlobe" : "Détail de l’offre"}
          </h2>

          {showLinePricing ? (
            <div className="fq-table-wrap">
              <table className="sn-ui-table fq-table">
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
              <table className="sn-ui-table fq-table fq-table--condensed">
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
                  <span>{hasInstaller ? "Total SolarGlobe HT" : "Total HT"}</span>
                  <span>{formatEurLeading(totals.total_ht)}</span>
                </div>
                {totalDiscountFromLines > 0.0001 ? (
                  <div className="fq-totals-row">
                    <span>Remise</span>
                    <span>− {formatEurLeading(totalDiscountFromLines)}</span>
                  </div>
                ) : null}
                <div className="fq-totals-row">
                  <span>{hasInstaller ? `${tvaLabel} (SolarGlobe)` : tvaLabel}</span>
                  <span>{formatEurLeading(totals.total_vat)}</span>
                </div>
                <div className="fq-totals-row fq-totals-row--sep fq-totals-row--emph">
                  <span>{hasInstaller ? `Total SolarGlobe TTC (${currency})` : `Total TTC (${currency})`}</span>
                  <span>{formatEurLeading(totals.total_ttc)}</span>
                </div>
              </div>
            </div>

            {hasInstaller ? (
              <>
                {/* B — Pose par installateur RGE indépendant (hors total facturable SolarGlobe). */}
                <section className="fq-installer-block" aria-label="Pose par installateur RGE indépendant">
                  <h2 className="fq-erp-offer-title fq-installer-title">
                    B — Pose par installateur RGE indépendant
                  </h2>
                  {showLinePricing ? (
                    <div className="fq-table-wrap">
                      <table className="sn-ui-table fq-table">
                        <thead>
                          <tr>
                            <th>Nom et description</th>
                            <th className="fq-center">Qté</th>
                            <th className="fq-num">PU HT</th>
                            <th className="fq-num">Total HT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {installerLines.map((row, idx) => (
                            <tr key={idx}>
                              <td>
                                <div className="fq-line-desc">
                                  {String(row.label ?? "—")}
                                  {row.description ? (
                                    <div className="fq-line-desc-body">{String(row.description)}</div>
                                  ) : null}
                                </div>
                              </td>
                              <td className="fq-center">
                                {row.quantity != null ? Number(row.quantity).toLocaleString("fr-FR") : "—"}
                              </td>
                              <td className="fq-num">{formatEurLeading(row.unit_price_ht)}</td>
                              <td className="fq-num">{formatEurLeading(row.total_line_ht)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <ul className="fq-installer-condensed">
                      {installerLines.map((row, idx) => (
                        <li key={idx}>{String(row.label ?? "—")}</li>
                      ))}
                    </ul>
                  )}
                  <div className="fq-totals">
                    <div className="fq-totals-inner">
                      <div className="fq-totals-row">
                        <span>Estimation pose HT</span>
                        <span>{formatEurLeading(installerTotals.total_ht)}</span>
                      </div>
                      <div className="fq-totals-row">
                        <span>{installerTvaLabel} (estimative)</span>
                        <span>{formatEurLeading(installerTotals.total_vat)}</span>
                      </div>
                      <div className="fq-totals-row fq-totals-row--sep fq-totals-row--emph">
                        <span>Estimation pose TTC ({currency})</span>
                        <span>{formatEurLeading(installerTotals.total_ttc)}</span>
                      </div>
                    </div>
                  </div>
                  <p className="fq-installer-mention" role="note">
                    La pose des panneaux photovoltaïques en toiture, le raccordement électrique d’exécution au
                    tableau général, la mise en service technique et les vérifications sur chantier sont réalisés et
                    facturés directement par un installateur RGE indépendant, juridiquement distinct de SolarGlobe.
                    Ces prestations ne sont ni réalisées, ni commandées, ni sous-traitées, ni facturées, ni
                    encaissées par SolarGlobe. Les documents contractuels, devis, facture, attestations d’assurance,
                    garanties et conditions d’intervention relèvent exclusivement de l’installateur.
                  </p>
                </section>

                {/* C — Coût global indicatif du projet (SolarGlobe + estimation pose). */}
                <section className="fq-project-indicative-block" aria-label="Coût global indicatif du projet">
                  <h2 className="fq-erp-offer-title fq-installer-title">
                    C — Coût global indicatif du projet
                  </h2>
                  <div className="fq-totals">
                    <div className="fq-totals-inner">
                      <div className="fq-totals-row">
                        <span>Total SolarGlobe TTC</span>
                        <span>{formatEurLeading(totals.total_ttc)}</span>
                      </div>
                      <div className="fq-totals-row">
                        <span>+ Estimation pose installateur TTC</span>
                        <span>{formatEurLeading(installerTotals.total_ttc)}</span>
                      </div>
                      <div className="fq-totals-row fq-totals-row--sep fq-totals-row--emph">
                        <span>= Coût global indicatif TTC ({currency})</span>
                        <span>{formatEurLeading(projectIndicativeTotals.total_ttc)}</span>
                      </div>
                    </div>
                  </div>
                  <p className="fq-installer-mention" role="note">
                    Ce coût global est donné à titre indicatif pour présenter le budget complet du projet. Il ne
                    constitue pas le montant facturé par SolarGlobe. Il ne vaut ni commande de travaux, ni
                    engagement de SolarGlobe sur la réalisation, la facturation ou les obligations propres de
                    l’installateur RGE indépendant.
                  </p>
                </section>
              </>
            ) : null}

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
              {hasPaymentBlock || sgTtcPay > 0 ? (
                <section className="fq-payment-section" aria-labelledby="fq-pay-title">
                  <h3 id="fq-pay-title" className="fq-erp-gold-heading">
                    Modalités de paiement
                  </h3>
                  <div className="fq-payment-body">
                    {sgTtcPay > 0 ? (
                      <div className="fq-echeancier-solarglobe">
                        <p style={{ fontWeight: 700, margin: "0 0 4px" }}>Échéancier de paiement SolarGlobe</p>
                        <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                          <li>
                            {acomptePctPay} % du montant SolarGlobe TTC à la signature du devis / à la commande
                            {acompteTtcPay > 0 ? <> — soit {formatEurLeading(acompteTtcPay)} TTC</> : null}, encaissé
                            après expiration du délai légal applicable aux contrats conclus hors établissement.
                          </li>
                          <li>
                            {soldePctPay} % du montant SolarGlobe TTC restant dû après réception du certificat
                            Consuel ou de l’attestation de conformité transmise par le Client, l’installateur RGE
                            indépendant ou l’organisme compétent
                            {soldeTtcPay > 0 ? <> — soit {formatEurLeading(soldeTtcPay)} TTC</> : null}.
                          </li>
                        </ul>
                      </div>
                    ) : null}
                    {hasInstaller ? (
                      <div className="fq-echeancier-pose">
                        <p style={{ fontWeight: 700, margin: "6px 0 4px" }}>Paiement de la pose</p>
                        <p style={{ margin: 0 }}>
                          La prestation de pose est réglée directement par le Client à l’installateur RGE
                          indépendant, selon les modalités propres à cet installateur. SolarGlobe n’encaisse aucune
                          somme au titre de la pose et n’intervient pas dans la relation financière entre le Client
                          et l’installateur.
                        </p>
                      </div>
                    ) : null}
                    {payload.deposit_display?.note ? (
                      <p className="fq-deposit-note">{String(payload.deposit_display.note)}</p>
                    ) : null}
                    {payload.payment_terms ? <p>{payload.payment_terms}</p> : null}
                  </div>
                </section>
              ) : null}

              <div className="fq-sign-section-wrap">
                <section className="fq-signature-erp" aria-labelledby="fq-accord-title">
                  <h3 id="fq-accord-title">Bon pour accord</h3>
                  <p className="fq-accord-intro">{accordIntro}</p>
                  {hasInstaller ? (
                    <p
                      className="fq-accord-scope-notice"
                      role="note"
                      style={{
                        margin: "0 0 10px",
                        padding: "8px 10px",
                        border: "1px solid #b08900",
                        borderRadius: 6,
                        background: "#fffaf0",
                        fontSize: 10.5,
                        lineHeight: 1.45,
                        fontWeight: 600,
                        color: "#5c4a00",
                      }}
                    >
                      La signature du présent devis engage exclusivement le Client pour les prestations de la
                      section A, soit le montant facturé par SolarGlobe. Elle ne vaut ni commande, ni acceptation,
                      ni validation contractuelle des travaux de pose décrits en section B, lesquels relèvent
                      exclusivement d’une relation contractuelle et financière directe entre le Client et
                      l’installateur RGE indépendant. La prestation de pose est facturée directement par
                      l’installateur RGE indépendant et n’est ni facturée ni encaissée par SolarGlobe. Le coût
                      global indiqué en section C est purement indicatif et ne constitue pas le montant facturé par
                      SolarGlobe.
                    </p>
                  ) : null}
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
                  <div className="fq-express-exec" aria-label="Demande expresse d'exécution anticipée">
                    <span className="fq-express-exec-title">
                      Demande expresse d&apos;exécution anticipée des prestations
                    </span>
                    <p className="fq-express-exec-text">
                      Je demande expressément à SolarGlobe de commencer avant l&apos;expiration du délai légal de
                      rétractation les prestations d&apos;étude prévisionnelle, dimensionnement, accompagnement
                      administratif, préparation documentaire, déclaration préalable et coordination commerciale et
                      documentaire du projet sur le seul périmètre SolarGlobe.
                    </p>
                    <p className="fq-express-exec-text">
                      Je reconnais avoir été informé qu&apos;en cas d&apos;exercice de mon droit de rétractation après le
                      commencement de ces prestations, je pourrai être tenu au paiement du montant correspondant aux
                      prestations effectivement réalisées jusqu&apos;à la communication de ma décision de me rétracter,
                      conformément aux dispositions du Code de la consommation.
                    </p>
                    <label
                      className={`fq-express-exec-opt${expressInteractive ? "" : " fq-express-exec-opt--static"}`}
                    >
                      {expressInteractive ? (
                        <input
                          type="checkbox"
                          checked={expressChecked}
                          onChange={(e) => onExpressExecutionRequestedChange?.(e.target.checked)}
                          className="fq-express-exec-checkbox"
                        />
                      ) : (
                        <span className="fq-express-exec-faux-cb" aria-hidden="true">
                          {expressChecked ? "☑" : "☐"}
                        </span>
                      )}
                      <span className="fq-express-exec-opt-text">
                        Je demande expressément le commencement immédiat des prestations SolarGlobe.
                      </span>
                    </label>
                  </div>
                  <div className="fq-signature-grid">
                    <SignatureBlock
                      label="Signature du client"
                      interactive={interactiveSignatures}
                      imageSrc={signatureClientImage}
                      onImageLoad={onSignatureClientImageLoad}
                      onImageError={onSignatureClientImageError}
                      onClick={onSignatureClientClick}
                      emptyHint={interactiveSignatures ? "Cliquer pour ouvrir la signature" : (signatureLockedHint ?? " ")}
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
                      emptyHint={interactiveSignatures ? "Cliquer pour ouvrir la signature" : (signatureLockedHint ?? " ")}
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


      <section className="fq-consumer-legal" aria-label="Informations légales consommateur">
        <h3 className="fq-erp-gold-heading">Droit de rétractation (contrat hors établissement ou à distance)</h3>
        <p>
          Conformément aux articles L221-18 et suivants du Code de la consommation, le client consommateur dispose
          d&apos;un délai de quatorze (14) jours à compter de la signature du présent devis pour exercer son droit de
          rétractation, sans avoir à motiver sa décision ni à supporter de pénalité. Pour l&apos;exercer, il peut
          utiliser le formulaire de rétractation joint en annexe du présent document ou adresser toute autre
          déclaration dénuée d&apos;ambiguïté à l&apos;entreprise. Conformément à l&apos;article L221-10 du même code,
          pour un contrat conclu hors établissement, l&apos;entreprise ne peut recevoir aucun paiement avant
          l&apos;expiration d&apos;un délai de sept (7) jours à compter de la conclusion du contrat.
        </p>
        {payload.legal_mediator ? (
          <p>
            <strong>Médiation de la consommation — </strong>
            Conformément aux articles L611-1 et suivants du Code de la consommation, après démarche écrite préalable
            auprès de l&apos;entreprise restée sans réponse satisfaisante, le client consommateur peut recourir
            gratuitement au médiateur de la consommation : <strong>{payload.legal_mediator.name}</strong>
            {payload.legal_mediator.address ? <> — {payload.legal_mediator.address}</> : null}
            {payload.legal_mediator.phone ? <> — Tél. : {payload.legal_mediator.phone}</> : null}
            {payload.legal_mediator.url ? <> — {payload.legal_mediator.url}</> : null}
            {payload.legal_mediator.email ? <> — {payload.legal_mediator.email}</> : null}.
          </p>
        ) : null}
      </section>

      <section className="fq-retract-form" aria-label="Formulaire de rétractation">
        <h3 className="fq-erp-gold-heading">Annexe — Formulaire de rétractation</h3>
        <p className="fq-retract-intro">
          (Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat,
          dans un délai de quatorze jours à compter de sa signature.)
        </p>
        <div className="fq-retract-body">
          <p>
            À l&apos;attention de <strong>{companyName}</strong> — coordonnées indiquées en tête du présent devis :
          </p>
          <p>
            Je/Nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la
            prestation objet du devis{showOfficial && payload.number ? <> n° {payload.number}</> : null}, signé le :
            ______________________
          </p>
          <p>Nom du (des) consommateur(s) : _____________________________________________________</p>
          <p>Adresse du (des) consommateur(s) : __________________________________________________</p>
          <p>Signature du (des) consommateur(s) (uniquement en cas de notification sur papier) :</p>
          <p>Date : ______________________</p>
          <p className="fq-retract-asterisk">(*) Rayez la mention inutile.</p>
        </div>
      </section>

      <PdfCgvSection legalCgv={payload.legal_cgv} />
      </div>

      {variant === "pdf" ? (
        <div id="pdf-ready" data-status={pdfReadyMarker ? "ready" : "pending"} aria-hidden="true" />
      ) : null}
    </div>
  );
}
