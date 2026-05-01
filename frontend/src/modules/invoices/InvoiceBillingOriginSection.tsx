/**
 * Origine de facturation — base préparation (`prepared_total_ttc_reference`) et type (acompte, solde…).
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
  /** Base préparation figée sur cette facture (metadata_json.prepared_total_ttc_reference). */
  preparedTotalTtcReference?: number | null;
  /** Total TTC facture — en brouillon, recalculé depuis les lignes. */
  invoiceTotalTtcForPct?: number | null;
}

function fmtEur2(n: number): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export default function InvoiceBillingOriginSection({
  quoteId,
  quote,
  quoteBillingRole,
  preparedTotalTtcReference,
  invoiceTotalTtcForPct,
}: InvoiceBillingOriginSectionProps) {
  const role = String(quoteBillingRole || "").toUpperCase();
  const prepOk =
    preparedTotalTtcReference != null &&
    Number.isFinite(preparedTotalTtcReference) &&
    preparedTotalTtcReference > 0.0001;
  const invoiceTtc =
    invoiceTotalTtcForPct != null && Number.isFinite(invoiceTotalTtcForPct)
      ? Math.max(0, invoiceTotalTtcForPct)
      : null;

  return (
    <section className="ib-origin-card sn-card" aria-labelledby="ib-origin-title">
      <h2 id="ib-origin-title" className="ib-origin-card__title">
        Origine de facturation
      </h2>
      {!quoteId ? (
        <p className="ib-origin-card__body">
          <strong>Facture indépendante</strong> — non issue d’un dossier lié. Les lignes et montants sont saisis
          directement sur cette facture.
        </p>
      ) : (
        <div className="ib-origin-card__body">
          <p className="ib-origin-card__line">
            <span className="ib-origin-label">Dossier lié</span>
            {quote?.quote_number ? (
              <Link to={`/quotes/${quoteId}`} className="ib-origin-link">
                {quote.quote_number}
              </Link>
            ) : (
              <Link to={`/quotes/${quoteId}`} className="ib-origin-link">
                Ouvrir le dossier
              </Link>
            )}
            {quote?.status ? (
              <span className="ib-origin-meta"> ({String(quote.status)})</span>
            ) : null}
          </p>
          <p className="ib-origin-card__line">
            <span className="ib-origin-label">Type de facturation</span>
            <span>{formatInvoiceOriginQuoteType(quoteBillingRole)}</span>
          </p>
          {prepOk ? (
            <div className="ib-origin-card__deposit" style={{ marginTop: 12 }}>
              <p className="ib-origin-card__line">
                <span className="ib-origin-label">Montant total préparé (référence)</span>
                <span>{fmtEur2(preparedTotalTtcReference)}</span>
              </p>
              {role === "DEPOSIT" && invoiceTtc != null ? (
                <>
                  <p className="ib-origin-card__line">
                    <span className="ib-origin-label">Montant facturé sur cette base (TTC)</span>
                    <span>{fmtEur2(invoiceTtc)}</span>
                  </p>
                  <p className="ib-origin-card__line">
                    <span className="ib-origin-label">Part de la base préparée</span>
                    <span>
                      {(
                        Math.round(
                          ((invoiceTtc / preparedTotalTtcReference) * 100 + Number.EPSILON) * 100
                        ) / 100
                      ).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                      %
                    </span>
                  </p>
                  <p className="qb-muted" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.45 }}>
                    Le pourcentage compare cette facture à la base préparation figée sur le document ; en brouillon, il
                    suit les lignes modifiées.
                  </p>
                </>
              ) : invoiceTtc != null ? (
                <p className="ib-origin-card__line">
                  <span className="ib-origin-label">Total TTC de cette facture</span>
                  <span>{fmtEur2(invoiceTtc)}</span>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="qb-muted" style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.45 }}>
              Base préparation non renseignée sur cette facture (référence métier absente). Les montants affichés
              ailleurs sur la page restent ceux des lignes et du récapitulatif financier.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
