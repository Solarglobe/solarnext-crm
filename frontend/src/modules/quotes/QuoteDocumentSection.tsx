/**
 * Bloc « Document » — identité du devis, client, mode d’affichage PDF (metadata_json.pdf_show_line_pricing).
 */

import React from "react";
import { Link } from "react-router-dom";
import { quoteBuilderTitleDisplay } from "./quoteUiStatus";

export interface QuoteDocumentSectionProps {
  quoteNumber: string;
  status: string;
  clientDisplay: string | null;
  pdfShowLinePricing: boolean;
  canEdit: boolean;
  onPdfShowLinePricingChange: (value: boolean) => void;
  studyId?: string | null;
  studyVersionId?: string | null;
  studyLabel?: string | null;
}

export default function QuoteDocumentSection({
  quoteNumber,
  status,
  clientDisplay,
  pdfShowLinePricing,
  canEdit,
  onPdfShowLinePricingChange,
  studyId,
  studyVersionId,
  studyLabel,
}: QuoteDocumentSectionProps) {
  const numeroDisplay = quoteBuilderTitleDisplay(quoteNumber, status);
  const studyHref =
    studyId && studyVersionId ? `/studies/${studyId}/versions/${studyVersionId}` : null;

  return (
    <section className="qb-doc-card sn-card" aria-labelledby="qb-doc-card-title">
      <div className="qb-doc-card__head">
        <h2 id="qb-doc-card-title" className="qb-doc-card__title">
          Document commercial
        </h2>
        <p className="qb-doc-card__subtitle">
          Identité du devis et options visibles sur le PDF client. Les totaux globaux s&apos;affichent toujours ; le détail
          tarifaire ligne par ligne est optionnel.
        </p>
      </div>
      <div className="qb-doc-card__grid">
        <div className="qb-doc-kv">
          <span className="qb-doc-kv__label">Numéro</span>
          <span className="qb-doc-kv__value qb-mono">{numeroDisplay}</span>
        </div>
        <div className="qb-doc-kv qb-doc-kv--grow">
          <span className="qb-doc-kv__label">Client</span>
          <span className="qb-doc-kv__value">{clientDisplay?.trim() ? clientDisplay : "— (non renseigné)"}</span>
        </div>
        <div className="qb-doc-kv qb-doc-kv--grow">
          <span className="qb-doc-kv__label">Étude liée</span>
          <span className="qb-doc-kv__value">
            {studyHref ? (
              <Link to={studyHref} className="qb-doc-study-link">
                {studyLabel || "Ouvrir l’étude"}
              </Link>
            ) : (
              <span className="qb-muted">Aucune — le devis peut rester autonome.</span>
            )}
          </span>
        </div>
      </div>

      <fieldset className="qb-doc-fieldset" disabled={!canEdit}>
        <legend className="qb-doc-fieldset__legend">Affichage du document (PDF client)</legend>
        <div className="qb-doc-radio-row">
          <label className={`qb-doc-radio ${pdfShowLinePricing ? "qb-doc-radio--active" : ""}`}>
            <input
              type="radio"
              name="pdf_show_line_pricing"
              checked={pdfShowLinePricing}
              onChange={() => onPdfShowLinePricingChange(true)}
            />
            <span className="qb-doc-radio__main">Oui — détail des prix</span>
            <span className="qb-doc-radio__hint">Désignation, quantité, PU HT, TVA, total ligne</span>
          </label>
          <label className={`qb-doc-radio ${!pdfShowLinePricing ? "qb-doc-radio--active" : ""}`}>
            <input
              type="radio"
              name="pdf_show_line_pricing"
              checked={!pdfShowLinePricing}
              onChange={() => onPdfShowLinePricingChange(false)}
            />
            <span className="qb-doc-radio__main">Non — document condensé</span>
            <span className="qb-doc-radio__hint">Libellé, référence, description — totaux HT / TVA / TTC en bas</span>
          </label>
        </div>
      </fieldset>

      {!pdfShowLinePricing ? (
        <div className="qb-doc-preview-callout" role="status">
          <span className="fin-badge fin-badge--info">Aperçu logique</span>
          <p>
            Le client ne verra pas le détail tarifaire ligne par ligne (PU, TVA, montants par ligne). Seuls les totaux
            globaux HT, TVA et TTC apparaîtront sur le devis. Complétez les colonnes <strong>Réf.</strong> et{" "}
            <strong>Description</strong> pour un rendu clair sur le PDF client.
          </p>
        </div>
      ) : null}
    </section>
  );
}
