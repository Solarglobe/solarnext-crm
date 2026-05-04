/**
 * Badges statuts devis / facture / avoir — palette SaaS sobre.
 */

import React from "react";
import { formatCreditNoteStatusFr, formatInvoiceStatusFr, formatQuoteStatusFr } from "../../../finance/financialLabels";

const QUOTE_STYLES: Record<string, string> = {
  DRAFT: "sn-badge sn-badge-neutral",
  READY_TO_SEND: "sn-badge sn-badge-info",
  SENT: "sn-badge sn-badge-info",
  ACCEPTED: "sn-badge sn-badge-success",
  REJECTED: "sn-badge sn-badge-danger",
  EXPIRED: "sn-badge sn-badge-warn",
  CANCELLED: "sn-badge sn-badge-danger",
};

const INV_STYLES: Record<string, string> = {
  DRAFT: "sn-badge sn-badge-neutral",
  ISSUED: "sn-badge sn-badge-info",
  PARTIALLY_PAID: "sn-badge sn-badge-warn",
  PAID: "sn-badge sn-badge-success",
  CANCELLED: "sn-badge sn-badge-danger",
};

const CN_STYLES: Record<string, string> = {
  DRAFT: "sn-badge sn-badge-neutral",
  ISSUED: "sn-badge sn-badge-info",
  CANCELLED: "sn-badge sn-badge-danger",
};

const LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  READY_TO_SEND: "Prêt à envoyer",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
};

function norm(s: string | undefined) {
  return String(s || "")
    .trim()
    .toUpperCase();
}

export function QuoteStatusBadge({ status }: { status: string | undefined }) {
  const n = norm(status);
  const cls = QUOTE_STYLES[n] || "sn-badge sn-badge-neutral";
  const label = formatQuoteStatusFr(status);
  return <span className={cls}>{label}</span>;
}

export function InvoiceStatusBadge({ status }: { status: string | undefined }) {
  const n = norm(status);
  const cls = INV_STYLES[n] || "sn-badge sn-badge-neutral";
  const label = formatInvoiceStatusFr(status);
  return <span className={cls}>{label}</span>;
}

export function CreditNoteStatusBadge({ status }: { status: string | undefined }) {
  const n = norm(status);
  const cls = CN_STYLES[n] || "sn-badge sn-badge-neutral";
  const label = formatCreditNoteStatusFr(status);
  return <span className={cls}>{label}</span>;
}
