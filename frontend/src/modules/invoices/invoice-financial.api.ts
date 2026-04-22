/**
 * Appels API suivi financier (paiements, avoirs, relances) — sous-ressources /api/invoices/:id/...
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "../../services/api";
import type {
  InvoiceCreditNoteApi,
  InvoicePaymentApi,
  InvoiceReminderApi,
} from "./invoice-financial.types";

const API_BASE = getCrmApiBase();

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

export async function fetchInvoicePayments(invoiceId: string): Promise<InvoicePaymentApi[]> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/payments`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postInvoicePayment(
  invoiceId: string,
  body: {
    amount: number;
    payment_date: string;
    payment_method?: string;
    reference?: string;
    notes?: string;
  }
): Promise<InvoicePaymentApi> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/payments`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchInvoiceCreditNotes(invoiceId: string): Promise<InvoiceCreditNoteApi[]> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postCreditNoteDraftForInvoice(
  invoiceId: string,
  body: {
    lines: Array<{
      label?: string;
      description?: string;
      quantity: number;
      unit_price_ht: number;
      discount_ht?: number;
      vat_rate: number;
    }>;
    reason_code?: string;
    reason_text?: string;
  }
): Promise<Record<string, unknown>> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postIssueCreditNote(creditNoteId: string): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/credit-notes/${encodeURIComponent(creditNoteId)}/issue`, {
    method: "POST",
    headers: jsonHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchInvoiceReminders(invoiceId: string): Promise<InvoiceReminderApi[]> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/reminders`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function cancelPaymentApi(paymentId: string): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: "PATCH",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postInvoiceReminder(
  invoiceId: string,
  body: {
    reminded_at?: string;
    channel: string;
    note?: string | null;
    next_action_at?: string | null;
  }
): Promise<InvoiceReminderApi> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/reminders`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}
