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
  /** Base préparation figée (factures d’acompte récentes). */
  preparedTotalTtcReference?: number | null;
  /** Total TTC facture — en brouillon, recalculé depuis les lignes. */
  invoiceTotalTtcForDepositPct?: number | null;
}

function fmtEur2(n: number): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export default function InvoiceBillingOriginSection({
  quoteId,
  quote,
  quoteBillingRole,
  preparedTotalTtcReference,
  invoiceTotalTtcForDepositPct,
}: InvoiceBillingOriginSectionProps) {
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
          {String(quoteBillingRole || "").toUpperCase() === "DEPOSIT" &&
          preparedTotalTtcReference != null &&
          Number.isFinite(preparedTotalTtcReference) &&
          preparedTotalTtcReference > 0.0001 &&
          invoiceTotalTtcForDepositPct != null &&
          Number.isFinite(invoiceTotalTtcForDepositPct) ? (
            <div className="ib-origin-card__deposit" style={{ marginTop: 12 }}>
              <p className="ib-origin-card__line">
                <span className="ib-origin-label">Montant total des prestations</span>
                <span>{fmtEur2(preparedTotalTtcReference)}</span>
              </p>
              <p className="ib-origin-card__line">
                <span className="ib-origin-label">Acompte facturé (total TTC)</span>
                <span>{fmtEur2(Math.max(0, invoiceTotalTtcForDepositPct))}</span>
              </p>
              <p className="ib-origin-card__line">
                <span className="ib-origin-label">Part de la préparation</span>
                <span>
                  {(
                    Math.round(
                      ((Math.max(0, invoiceTotalTtcForDepositPct) / preparedTotalTtcReference) * 100 +
                        Number.EPSILON) *
                        100
                    ) / 100
                  ).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                  %
                </span>
              </p>
              <p className="qb-muted" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.45 }}>
                Le pourcentage est calculé sur la base de préparation figée sur cette facture ; il est mis à jour si vous
                modifiez les lignes (brouillon).
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
