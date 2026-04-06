import type { InvoiceStatusUi } from "./invoice.types";

export function toInvoiceStatusUi(status: string, opts: { isOverdue?: boolean }): InvoiceStatusUi {
  const s = String(status).toUpperCase();
  if (s === "DRAFT") return "draft";
  if (s === "CANCELLED") return "cancelled";
  if (s === "PAID") return "paid";
  if (s === "PARTIALLY_PAID") return "partial";
  if (s === "ISSUED") return opts.isOverdue ? "overdue" : "sent";
  return "draft";
}

export function invoiceStatusLabel(ui: InvoiceStatusUi): string {
  const m: Record<InvoiceStatusUi, string> = {
    draft: "Brouillon",
    sent: "Émise",
    partial: "Partiellement payée",
    paid: "Payée",
    cancelled: "Annulée",
    overdue: "En retard",
  };
  return m[ui];
}

export function invoiceStatusClass(ui: InvoiceStatusUi): string {
  const base = "ib-status";
  const map: Record<InvoiceStatusUi, string> = {
    draft: "ib-status--draft",
    sent: "ib-status--sent",
    partial: "ib-status--partial",
    paid: "ib-status--paid",
    cancelled: "ib-status--cancelled",
    overdue: "ib-status--overdue",
  };
  return `${base} ${map[ui]}`;
}
