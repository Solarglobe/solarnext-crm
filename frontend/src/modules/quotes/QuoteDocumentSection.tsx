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
  /** Annexes légales PDF (fusion serveur). */
  legalDocuments: { include_rge: boolean; include_decennale: boolean };
  onLegalDocumentsChange: (patch: Partial<{ include_rge: boolean; include_decennale: boolean }>) => void;
  /** Présence des fichiers côté organisation (aperçu validation). */
  complementaryConfigured?: { rge: boolean; decennale: boolean } | null;
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
  legalDocuments,
  onLegalDocumentsChange,
  complementaryConfigured,
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

      <fieldset className="qb-doc-fieldset" disabled={!canEdit}>
        <legend className="qb-doc-fieldset__legend">Documents inclus dans le devis (PDF)</legend>
        <p className="qb-doc-card__subtitle" style={{ marginTop: 0, marginBottom: 12 }}>
          Les conditions générales (CGV) sont toujours jointes automatiquement. Les attestations ci-dessous sont ajoutées en
          fin de PDF si vous les cochez (fichiers configurés dans Équipes &amp; entreprise → Documents légaux).
        </p>
        <ul className="qb-legal-docs-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li style={{ marginBottom: 10 }}>
            <span className="qb-muted">CGV — inclus automatiquement</span>
          </li>
          <li style={{ marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={legalDocuments.include_rge}
                onChange={(e) => onLegalDocumentsChange({ include_rge: e.target.checked })}
              />
              <span>
                Attestation RGE
                {complementaryConfigured && legalDocuments.include_rge && !complementaryConfigured.rge ? (
                  <span className="qb-error" style={{ display: "block", fontSize: 13, marginTop: 4 }}>
                    Document non configuré — la génération PDF sera refusée tant qu&apos;un fichier RGE n&apos;est pas
                    enregistré pour l&apos;organisation.
                  </span>
                ) : null}
              </span>
            </label>
          </li>
          <li>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: canEdit ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={legalDocuments.include_decennale}
                onChange={(e) => onLegalDocumentsChange({ include_decennale: e.target.checked })}
              />
              <span>
                Assurance décennale
                {complementaryConfigured && legalDocuments.include_decennale && !complementaryConfigured.decennale ? (
                  <span className="qb-error" style={{ display: "block", fontSize: 13, marginTop: 4 }}>
                    Document non configuré — la génération PDF sera refusée tant qu&apos;un fichier n&apos;est pas
                    enregistré pour l&apos;organisation.
                  </span>
                ) : null}
              </span>
            </label>
          </li>
        </ul>
      </fieldset>

      {!pdfShowLinePricing ? (
        <div className="qb-doc-preview-callout" role="status">
          <span className="sn-badge sn-badge-info">Aperçu logique</span>
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
