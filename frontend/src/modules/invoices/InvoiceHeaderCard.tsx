/**
 * En-tête facture — lecture immédiate (document financier pro).
 */

import React from "react";
import type { InvoiceStatusUi } from "./invoice.types";
import { invoiceStatusClass, invoiceStatusLabel } from "./invoiceStatusUi";

export interface InvoiceHeaderCardProps {
  invoiceNumberDisplay: string;
  statusUi: InvoiceStatusUi;
  statusRaw: string;
  clientLine: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  quoteBillingRole?: string | null;
  hasQuote: boolean;
  isOverdue: boolean;
}

function billingTypeLabel(role: string | null | undefined, hasQuote: boolean): string {
  if (!hasQuote) return "Facture libre / standard";
  const r = String(role || "STANDARD").toUpperCase();
  if (r === "DEPOSIT") return "Acompte";
  if (r === "BALANCE") return "Solde";
  return "Standard (lignes devis)";
}

function sourceLabel(hasQuote: boolean): string {
  return hasQuote ? "Issue d’un devis" : "Facture indépendante";
}

export default function InvoiceHeaderCard({
  invoiceNumberDisplay,
  statusUi,
  statusRaw,
  clientLine,
  issueDate,
  dueDate,
  currency,
  quoteBillingRole,
  hasQuote,
  isOverdue,
}: InvoiceHeaderCardProps) {
  const st = String(statusRaw).toUpperCase();
  const showOverdueBadge =
    isOverdue && !["PAID", "CANCELLED", "DRAFT"].includes(st);

  return (
    <section className="ib-header-card sn-card" aria-labelledby="ib-header-card-title">
      <div className="ib-header-card__top">
        <div>
          <p id="ib-header-card-title" className="ib-header-card__kicker">
            Facture
          </p>
          <p className="ib-header-card__number">{invoiceNumberDisplay}</p>
        </div>
        <div className="ib-header-card__badges">
          <span className={invoiceStatusClass(statusUi)}>{invoiceStatusLabel(statusUi)}</span>
          {showOverdueBadge ? <span className="ib-status ib-status--overdue">En retard</span> : null}
        </div>
      </div>

      <div className="ib-header-card__grid">
        <div className="ib-header-kv">
          <span className="ib-header-kv__l">Client</span>
          <span className="ib-header-kv__v">{clientLine || "—"}</span>
        </div>
        <div className="ib-header-kv">
          <span className="ib-header-kv__l">Date d&apos;émission</span>
          <span className="ib-header-kv__v">{issueDate || "—"}</span>
        </div>
        <div className="ib-header-kv">
          <span className="ib-header-kv__l">Date d&apos;échéance</span>
          <span className="ib-header-kv__v">{dueDate || "—"}</span>
        </div>
        <div className="ib-header-kv">
          <span className="ib-header-kv__l">Devise</span>
          <span className="ib-header-kv__v">{currency}</span>
        </div>
        <div className="ib-header-kv">
          <span className="ib-header-kv__l">Type de facture</span>
          <span className="ib-header-kv__v">{billingTypeLabel(quoteBillingRole, hasQuote)}</span>
        </div>
        <div className="ib-header-kv">
          <span className="ib-header-kv__l">Source</span>
          <span className="ib-header-kv__v">{sourceLabel(hasQuote)}</span>
        </div>
      </div>
    </section>
  );
}
