/**
 * Origine de facturation — traçabilité devis / type (acompte, solde…).
 */

import React from "react";
import { Link } from "react-router-dom";
import { formatInvoiceOriginQuoteType } from "./invoiceBillingLabels";

export interface QuoteSummary {
  id: string;
  quote_number?: string | null;
  status?: string | null;
}

export interface InvoiceBillingOriginSectionProps {
  quoteId: string | null;
  quote: QuoteSummary | null | undefined;
  quoteBillingRole?: string | null;
}

export default function InvoiceBillingOriginSection({ quoteId, quote, quoteBillingRole }: InvoiceBillingOriginSectionProps) {
  return (
    <section className="ib-origin-card sn-card" aria-labelledby="ib-origin-title">
      <h2 id="ib-origin-title" className="ib-origin-card__title">
        Origine de facturation
      </h2>
      {!quoteId ? (
        <p className="ib-origin-card__body">
          <strong>Facture indépendante</strong> — non issue d’un devis. Les lignes et montants sont saisis directement sur
          cette facture.
        </p>
      ) : (
        <div className="ib-origin-card__body">
          <p className="ib-origin-card__line">
            <span className="ib-origin-label">Devis source</span>
            {quote?.quote_number ? (
              <Link to={`/quotes/${quoteId}`} className="ib-origin-link">
                {quote.quote_number}
              </Link>
            ) : (
              <Link to={`/quotes/${quoteId}`} className="ib-origin-link">
                Ouvrir le devis
              </Link>
            )}
            {quote?.status ? (
              <span className="ib-origin-meta"> ({String(quote.status)})</span>
            ) : null}
          </p>
          <p className="ib-origin-card__line">
            <span className="ib-origin-label">Type depuis le devis</span>
            <span>{formatInvoiceOriginQuoteType(quoteBillingRole)}</span>
          </p>
        </div>
      )}
    </section>
  );
}
