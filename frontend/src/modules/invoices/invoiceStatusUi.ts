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
  const map: Record<InvoiceStatusUi, string> = {
    draft: "sn-badge sn-badge-neutral",
    sent: "sn-badge sn-badge-info",
    partial: "sn-badge sn-badge-warn",
    paid: "sn-badge sn-badge-success",
    cancelled: "sn-badge sn-badge-neutral",
    overdue: "sn-badge sn-badge-danger",
  };
  return map[ui];
}
