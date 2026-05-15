/**
 * Bloc CGV en fin de PDF d'étude (HTML ou URL + QR ; mode PDF fusionné côté serveur).
 */

import type { QuotePdfLegalCgv } from "../../../modules/quotes/quoteDocumentTypes";

export type PdfLegalCgvVm = QuotePdfLegalCgv | null | undefined;

export default function PdfCgvSection({ legalCgv }: { legalCgv?: PdfLegalCgvVm }) {
  if (!legalCgv || legalCgv.mode === "pdf") {
    return null;
  }

  if (legalCgv.mode === "html") {
    return (
      <section className="pdf-cgv" aria-label="Conditions générales de vente">
        <h2 className="pdf-cgv__title">Conditions Générales de Vente</h2>
        <div className="pdf-cgv__html" dangerouslySetInnerHTML={{ __html: legalCgv.html }} />
      </section>
    );
  }

  if (legalCgv.mode === "url") {
    return (
      <section className="pdf-cgv pdf-cgv--url" aria-label="Conditions générales de vente">
        <h2 className="pdf-cgv__title">Conditions Générales de Vente</h2>
        <p className="pdf-cgv__intro">Les Conditions Générales de Vente sont disponibles à l&apos;adresse suivante :</p>
        <p className="pdf-cgv__url">
          <a href={legalCgv.url} target="_blank" rel="noopener noreferrer">
            {legalCgv.url}
          </a>
        </p>
        {legalCgv.qr_data_url ? (
          <div className="pdf-cgv__qr-wrap">
            <img src={legalCgv.qr_data_url} alt="" className="pdf-cgv__qr" width={120} height={120} />
          </div>
        ) : null}
      </section>
    );
  }

  return null;
}
