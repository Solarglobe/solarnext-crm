/**
 * Badges statuts devis / facture / avoir — palette SaaS sobre.
 */

import React from "react";
import { formatCreditNoteStatusFr, formatInvoiceStatusFr, formatQuoteStatusFr } from "../../../finance/financialLabels";

const QUOTE_STYLES: Record<string, string> = {
  DRAFT: "fin-badge fin-badge--neutral",
  READY_TO_SEND: "fin-badge fin-badge--info",
  SENT: "fin-badge fin-badge--info",
  ACCEPTED: "fin-badge fin-badge--success",
  REJECTED: "fin-badge fin-badge--muted",
  EXPIRED: "fin-badge fin-badge--warning",
  CANCELLED: "fin-badge fin-badge--danger",
};

const INV_STYLES: Record<string, string> = {
  DRAFT: "fin-badge fin-badge--neutral",
  ISSUED: "fin-badge fin-badge--info",
  PARTIALLY_PAID: "fin-badge fin-badge--warning",
  PAID: "fin-badge fin-badge--success",
  CANCELLED: "fin-badge fin-badge--danger",
};

const CN_STYLES: Record<string, string> = {
  DRAFT: "fin-badge fin-badge--neutral",
  ISSUED: "fin-badge fin-badge--info",
  CANCELLED: "fin-badge fin-badge--danger",
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
  const cls = QUOTE_STYLES[n] || "fin-badge fin-badge--neutral";
  const label = formatQuoteStatusFr(status);
  return <span className={cls}>{label}</span>;
}

export function InvoiceStatusBadge({ status }: { status: string | undefined }) {
  const n = norm(status);
  const cls = INV_STYLES[n] || "fin-badge fin-badge--neutral";
  const label = formatInvoiceStatusFr(status);
  return <span className={cls}>{label}</span>;
}

export function CreditNoteStatusBadge({ status }: { status: string | undefined }) {
  const n = norm(status);
  const cls = CN_STYLES[n] || "fin-badge fin-badge--neutral";
  const label = formatCreditNoteStatusFr(status);
  return <span className={cls}>{label}</span>;
}
