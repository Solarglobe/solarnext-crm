/**
 * Bloc facturation devis — résumé TTC/HT, liste factures, actions (acompte / solde / complète).
 */

import "./quote-billing-ux.css";
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import type { QuoteInvoiceBillingContext } from "../../services/financial.api";
import { formatInvoiceType } from "../invoices/invoiceBillingLabels";
import { invoiceStatusClass, invoiceStatusLabel, toInvoiceStatusUi } from "../invoices/invoiceStatusUi";

function fmtEur(n: number, opts?: { fraction?: number }) {
  const f = opts?.fraction ?? 2;
  return n.toLocaleString("fr-FR", { minimumFractionDigits: f, maximumFractionDigits: f }) + " €";
}

export interface QuoteBillingUxPanelProps {
  quoteId: string;
  billCtx: QuoteInvoiceBillingContext | null;
  billLoading: boolean;
  /** Si défini, le bouton acompte appelle ce callback (ex. modale sur le builder). Sinon navigation `toDepositHref`. */
  onOpenDepositModal?: () => void;
  /** URL création acompte (sans modale), ex. `/invoices/new?fromQuote=…&billingRole=DEPOSIT` */
  depositHref?: string;
  /** URL solde (sans montant en query) — requis si `showActions` */
  balanceHref?: string;
  /** URL facture complète — requis si `showActions` */
  standardFullHref?: string;
  layout?: "default" | "compact";
  /** Résumé + liste seuls (ex. page saisie acompte avec formulaire séparé). */
  showActions?: boolean;
}

export default function QuoteBillingUxPanel({
  quoteId: quoteIdProp,
  billCtx,
  billLoading,
  onOpenDepositModal,
  depositHref,
  balanceHref,
  standardFullHref,
  layout = "default",
  showActions = true,
}: QuoteBillingUxPanelProps) {
  const nothingInvoiced = useMemo(() => (billCtx?.invoiced_ttc ?? 0) <= 0.02, [billCtx?.invoiced_ttc]);
  const showStandardFull = Boolean(billCtx?.can_create_standard_full);
  const showDeposit = Boolean(billCtx?.can_create_deposit);
  const showBalance = Boolean(billCtx?.can_create_balance && !nothingInvoiced);
  const hasAnyAction = showStandardFull || showDeposit || showBalance;

  const rootClass = layout === "compact" ? "qb-billing-ux qb-billing-ux--compact" : "qb-billing-ux";

  if (billLoading) {
    return (
      <div className={rootClass} aria-busy="true">
        <p className="qb-billing-ux__loading">Chargement de la facturation…</p>
      </div>
    );
  }

  if (!billCtx) {
    return (
      <div className={rootClass}>
        <p className="qb-muted" style={{ margin: 0 }}>
          Impossible de charger le suivi des factures.
          {standardFullHref ? (
            <>
              {" "}
              <Link to={standardFullHref} className="qb-billing-fallback-link">
                Préparer une facture depuis ce devis
              </Link>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  if (billCtx.quote_zero_total) {
    return (
      <div className={rootClass}>
        <p className="qb-muted" style={{ margin: 0 }}>
          Total devis nul : la facturation n&apos;est pas proposée ici.
        </p>
      </div>
    );
  }

  const linked = billCtx.linked_invoices ?? [];

  return (
    <div className={rootClass} id={`quote-billing-ux-${quoteIdProp}`}>
      <div className="qb-billing-ux__hero">
        <div className="qb-billing-ux__hero-main">
          <p className="qb-billing-ux__kicker">Synthèse facturation</p>
          <div className="qb-billing-ux__ttc-row">
            <div className="qb-billing-ux__ttc-block">
              <span className="qb-billing-ux__label">Total devis TTC</span>
              <span className="qb-billing-ux__ttc-value">{fmtEur(billCtx.quote_total_ttc ?? 0)}</span>
            </div>
            <div className="qb-billing-ux__ttc-block">
              <span className="qb-billing-ux__label">Déjà facturé TTC</span>
              <span className="qb-billing-ux__ttc-value qb-billing-ux__ttc-value--muted">
                {fmtEur(billCtx.invoiced_ttc ?? 0)}
              </span>
            </div>
            <div className="qb-billing-ux__ttc-block qb-billing-ux__ttc-block--accent">
              <span className="qb-billing-ux__label">Reste à facturer</span>
              <span className="qb-billing-ux__ttc-value qb-billing-ux__ttc-value--accent">
                {fmtEur(billCtx.remaining_ttc ?? 0)}
              </span>
            </div>
          </div>
          <p className="qb-billing-ux__ht-sub">
            HT devis {fmtEur(billCtx.quote_total_ht ?? 0, { fraction: 2 })} · TVA{" "}
            {fmtEur(billCtx.quote_total_vat ?? 0, { fraction: 2 })}{" "}
            <span className="qb-billing-ux__ht-hint">(référence devis — non modifié après acceptation)</span>
          </p>
        </div>
      </div>

      {linked.length > 0 ? (
        <div className="qb-billing-ux__list-wrap">
          <h3 className="qb-billing-ux__list-title">Factures liées</h3>
          <ul className="qb-billing-ux__list" aria-label="Factures liées au devis">
            {linked.map((inv) => {
              const role = (inv.quote_billing_role || "STANDARD").toUpperCase();
              const typeLabel = formatInvoiceType(role);
              const st = toInvoiceStatusUi(inv.status, {});
              return (
                <li key={inv.id} className="qb-billing-ux__list-row">
                  <Link to={`/invoices/${encodeURIComponent(inv.id)}`} className="qb-billing-ux__list-link">
                    {inv.invoice_number || inv.id.slice(0, 8)}
                  </Link>
                  <span className="qb-billing-ux__list-type">{typeLabel}</span>
                  <span className="qb-billing-ux__list-amt">{fmtEur(inv.total_ttc)}</span>
                  <span className="qb-billing-ux__list-ht-sub">{fmtEur(inv.total_ht ?? 0)} HT</span>
                  <span className={`qb-billing-ux__list-status ${invoiceStatusClass(st)}`}>{invoiceStatusLabel(st)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="qb-billing-ux__empty-list">Aucune facture liée pour l&apos;instant.</p>
      )}

      {showActions && nothingInvoiced && (billCtx.remaining_ttc ?? 0) > 0.02 ? (
        <p className="qb-billing-ux__hint">
          <strong>Conseil :</strong> « Facture complète » reprend les lignes du devis. Les acomptes / solde utilisent des
          lignes de synthèse proportionnelles au total du devis.
        </p>
      ) : null}

      {showActions ? (
      <div className="qb-billing-ux__actions" role="group" aria-label="Actions facturation">
        {showStandardFull && standardFullHref ? (
          <Link
            to={standardFullHref}
            className={`sn-btn sn-btn-sm ${nothingInvoiced ? "sn-btn-primary" : "sn-btn-outline-gold"}`}
            style={{ textDecoration: "none" }}
          >
            Facture complète
          </Link>
        ) : null}
        {showDeposit ? (
          onOpenDepositModal ? (
            <button type="button" className="sn-btn sn-btn-outline-gold sn-btn-sm" onClick={() => onOpenDepositModal()}>
              Créer un acompte
            </button>
          ) : depositHref ? (
            <Link to={depositHref} className="sn-btn sn-btn-outline-gold sn-btn-sm" style={{ textDecoration: "none" }}>
              Créer un acompte
            </Link>
          ) : null
        ) : null}
        {showBalance && balanceHref ? (
          <Link to={balanceHref} className="sn-btn sn-btn-primary sn-btn-sm" style={{ textDecoration: "none" }}>
            Facturer le solde
          </Link>
        ) : null}
        {!hasAnyAction ? (
          <p className="qb-muted" style={{ margin: 0 }}>
            Facturation à jour pour ce devis.
          </p>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
