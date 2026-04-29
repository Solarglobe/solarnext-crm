/**
 * Hub financier CRM — appels API pôle financier (devis / factures / paiements / avoirs / relances).
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";
import { billingRoleParamToApi } from "@/modules/invoices/invoiceBillingLabels";
import type { QuotePdfPayload } from "../modules/quotes/quoteDocumentTypes";

const API_BASE = getCrmApiBase();

export interface InvoiceListRow {
  id: string;
  invoice_number: string;
  status: string;
  total_ht?: number | string;
  total_vat?: number | string;
  total_ttc?: number | string;
  total_paid?: number | string;
  total_credited?: number | string;
  amount_due?: number | string;
  issue_date?: string | null;
  due_date?: string | null;
  quote_id?: string | null;
  client_id?: string | null;
  lead_id?: string | null;
  /** Présents sur GET /api/invoices (JOIN clients) */
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  has_pdf?: boolean;
  currency?: string;
  created_at?: string;
  /** Présent sur GET /api/invoices (colonne invoices.updated_at) */
  updated_at?: string;
  /** Colonne invoices.metadata_json (ex. is_test après cleanup prod). */
  metadata_json?: Record<string, unknown> | string | null;
}

export interface InvoicePaymentRow {
  id: string;
  amount: number | string;
  payment_date?: string;
  payment_method?: string | null;
  reference?: string | null;
  notes?: string | null;
  status?: string;
  created_at?: string;
  cancelled_at?: string | null;
}

export interface CreditNoteRow {
  id: string;
  credit_note_number: string;
  status: string;
  total_ht?: number | string;
  total_ttc?: number | string;
  issue_date?: string | null;
  created_at?: string;
  reason_text?: string | null;
  reason_code?: string | null;
  has_pdf?: boolean;
}

export interface ReminderRow {
  id: string;
  reminded_at: string;
  channel: string;
  note?: string | null;
  next_action_at?: string | null;
  created_at?: string;
}

export interface InvoiceDetail extends Record<string, unknown> {
  id: string;
  invoice_number: string;
  status: string;
  lead_id?: string | null;
  client_id?: string | null;
  quote_id?: string | null;
  payment_terms?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  currency?: string;
  lines?: unknown[];
  payments?: InvoicePaymentRow[];
  credit_notes?: CreditNoteRow[];
  reminders?: ReminderRow[];
  invoice_reminders?: ReminderRow[];
  documents?: unknown[];
  balance?: {
    total_ttc?: number;
    total_paid?: number;
    total_credited?: number;
    amount_due?: number;
  };
  total_credited?: number | string;
  suggested_status?: string;
  last_reminder_at?: string | null;
  is_overdue?: boolean;
  needs_followup?: boolean;
  /** Paramètre org « Échéance facture (jours) » — pour préremplissage échéance à l’édition. */
  org_default_invoice_due_days?: number | null;
}

export async function fetchInvoicesByClientId(clientId: string): Promise<InvoiceListRow[]> {
  const res = await apiFetch(
    `${API_BASE}/api/invoices?client_id=${encodeURIComponent(clientId)}&limit=500`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchInvoiceDetail(invoiceId: string): Promise<InvoiceDetail> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Ligne liste devis (GET /api/quotes) — tri created_at DESC côté serveur */
export interface QuoteListRow {
  id: string;
  quote_number: string;
  status: string;
  total_ht?: number | string;
  total_vat?: number | string;
  total_ttc?: number | string;
  document_snapshot_json?: Record<string, unknown> | string | null;
  created_at?: string;
  updated_at?: string;
  valid_until?: string | null;
  lead_id?: string | null;
  client_id?: string | null;
  study_id?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  /** Nom affichable du lead si pas de client */
  lead_full_name?: string | null;
  /** Nom client dérivé (société ou prénom + nom) — liste GET /api/quotes */
  client_name?: string | null;
  /** Nom du lead (équivalent lead_full_name) — liste GET /api/quotes */
  lead_name?: string | null;
  has_pdf?: boolean;
  has_signed_pdf?: boolean;
}

export interface QuoteDetailForBilling {
  id: string;
  client_id?: string | null;
  lead_id?: string | null;
  status?: string;
  notes?: string | null;
  billing_total_ttc?: number | null;
  billing_total_ht?: number | null;
  billing_total_vat?: number | null;
  billing_locked_at?: string | null;
}

/** Liste devis (GET /api/quotes) — tri created_at DESC côté serveur */
export async function fetchQuotesList(params?: { limit?: number; lead_id?: string; client_id?: string }): Promise<QuoteListRow[]> {
  const q = new URLSearchParams({ limit: String(Math.min(500, params?.limit ?? 100)) });
  if (params?.lead_id) q.set("lead_id", params.lead_id);
  if (params?.client_id) q.set("client_id", params.client_id);
  const res = await apiFetch(`${API_BASE}/api/quotes?${q.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchQuoteDetailForBilling(quoteId: string): Promise<QuoteDetailForBilling> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchInvoicesList(params?: { client_id?: string; lead_id?: string; limit?: number }): Promise<InvoiceListRow[]> {
  const q = new URLSearchParams({ limit: String(Math.min(500, params?.limit ?? 500)) });
  if (params?.client_id) q.set("client_id", params.client_id);
  if (params?.lead_id) q.set("lead_id", params.lead_id);
  const res = await apiFetch(`${API_BASE}/api/invoices?${q.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function createInvoiceDraft(body: {
  client_id?: string | null;
  lead_id?: string | null;
  quote_id?: string | null;
  lines?: unknown[];
  notes?: string;
  payment_terms?: string;
  issue_date?: string | null;
  due_date?: string | null;
}): Promise<InvoiceDetail> {
  const res = await apiFetch(`${API_BASE}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function patchInvoice(invoiceId: string, body: Record<string, unknown>): Promise<InvoiceDetail> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function patchInvoiceStatus(invoiceId: string, status: string): Promise<InvoiceDetail> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function duplicateInvoiceApi(invoiceId: string): Promise<InvoiceDetail> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/duplicate`, {
    method: "POST",
  });
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
): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function cancelPayment(paymentId: string): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/payments/${encodeURIComponent(paymentId)}/cancel`, {
    method: "PATCH",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postCreditNoteDraft(
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
): Promise<{ id: string }> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function issueCreditNote(creditNoteId: string): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/credit-notes/${encodeURIComponent(creditNoteId)}/issue`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postReminder(
  invoiceId: string,
  body: {
    reminded_at?: string;
    channel: string;
    note?: string;
    next_action_at?: string | null;
  }
): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/reminders`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postGenerateQuotePdf(quoteId: string): Promise<{
  document?: { url?: string; id?: string; file_name?: string };
  downloadUrl?: string;
  message?: string;
}> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/pdf`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** PDF devis → entity_documents du lead (Documents > Devis), sans upload. */
export async function postQuoteAddToDocuments(
  quoteId: string,
  opts?: { force_replace?: boolean }
): Promise<
  | {
      status: "conflict";
      existing_document_id: string;
      is_signed: boolean;
      message: string;
    }
  | { status: "created" | "replaced"; document?: Record<string, unknown> }
> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/add-to-documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_replace: opts?.force_replace === true }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 409) {
    return {
      status: "conflict",
      existing_document_id: String(data.existing_document_id ?? ""),
      is_signed: data.is_signed === true,
      message: typeof data.message === "string" ? data.message : "Document déjà existant",
    };
  }
  if (!res.ok) {
    throw new Error((data.error as string) || `Erreur ${res.status}`);
  }
  return data as { status: "created" | "replaced"; document?: Record<string, unknown> };
}

/** Finalisation terrain : figement si besoin, snapshot, PDF signé, statut Accepté (une requête API). */
export async function postFinalizeQuoteSigned(
  quoteId: string,
  body: {
    client_read_approved: boolean;
    signature_client_data_url: string;
    signature_company_data_url: string;
    signature_client_acceptance: { accepted: boolean; acceptedLabel?: string };
    signature_company_acceptance: { accepted: boolean; acceptedLabel?: string };
  }
): Promise<{
  document?: { id?: string; file_name?: string };
  downloadUrl?: string;
  message?: string;
}> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/finalize-signed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Payload miroir PDF (officiel ou aperçu brouillon) — page Présenter */
export async function getQuoteDocumentViewModel(
  quoteId: string,
  options?: { forInvoicePrep?: boolean }
): Promise<{
  mode: "official" | "draft";
  payload: QuotePdfPayload;
  organizationId: string;
}> {
  const qs =
    options?.forInvoicePrep === true
      ? `?for_invoice_prep=${encodeURIComponent("1")}`
      : "";
  const res = await apiFetch(
    `${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/document-view-model${qs}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postGenerateInvoicePdf(invoiceId: string): Promise<{
  document?: { url?: string; id?: string; file_name?: string };
  downloadUrl?: string;
  fileName?: string;
  replaced?: boolean;
  message?: string;
  observability?: {
    invoice_id?: string;
    invoice_number?: string | null;
    main_document?: { id?: string | null; file_name?: string | null; replaced?: boolean };
    mirror?: {
      entity_type?: string | null;
      entity_id?: string | null;
      document_id?: string | null;
      file_name?: string | null;
      replaced?: boolean;
    };
  };
}> {
  const res = await apiFetch(`${API_BASE}/api/invoices/${encodeURIComponent(invoiceId)}/pdf`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function postGenerateCreditNotePdf(creditNoteId: string): Promise<{ document?: { url?: string; id?: string } }> {
  const res = await apiFetch(`${API_BASE}/api/credit-notes/${encodeURIComponent(creditNoteId)}/pdf`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function duplicateQuote(quoteId: string): Promise<{ quote?: { id: string } }> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/duplicate`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Suppression serveur — autorisée uniquement pour les devis en brouillon (DRAFT). */
export async function deleteQuote(quoteId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}`, { method: "DELETE" });
  if (res.ok && res.status === 204) return;
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
}

/** Réponse PATCH /quotes/:id/status — détail devis enrichi + indicateur création auto client (ACCEPTED + lead sans client). */
export type PatchQuoteStatusResult = Record<string, unknown> & {
  client_auto_created?: boolean;
};

export async function patchQuoteStatus(quoteId: string, status: string): Promise<PatchQuoteStatusResult> {
  const res = await apiFetch(`${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return (await res.json()) as PatchQuoteStatusResult;
}

export type QuoteBillingRole = "STANDARD" | "DEPOSIT" | "BALANCE";

/** Facture liée au devis (liste synthèse). */
export interface QuoteLinkedInvoiceSummary {
  id: string;
  invoice_number: string;
  total_ttc: number;
  total_ht: number;
  status: string;
  quote_billing_role: string;
}

/** Contexte facturation depuis devis accepté (acompte / solde / complète). */
export interface QuoteInvoiceBillingContext {
  quote_id: string;
  quote_total_ttc: number;
  quote_total_ht?: number;
  quote_total_vat?: number;
  billing_total_ttc?: number;
  billing_total_ht?: number;
  billing_total_vat?: number;
  billing_locked_at?: string | null;
  billing_is_locked?: boolean;
  linked_invoices?: QuoteLinkedInvoiceSummary[];
  /** Total devis nul ou négligeable — pas de facturation acompte/solde/complète depuis ce devis. */
  quote_zero_total?: boolean;
  /** TTC engagé (brouillons inclus, hors annulées). */
  invoiced_ttc: number;
  /** TTC factures émises (hors brouillon / annulée). */
  invoiced_issued_ttc?: number;
  remaining_ttc: number;
  has_structured_deposit: boolean;
  deposit_ttc: number | null;
  has_deposit_invoice: boolean;
  has_balance_invoice: boolean;
  has_deposit_issued?: boolean;
  has_balance_issued?: boolean;
  can_create_deposit: boolean;
  can_create_balance: boolean;
  can_create_standard_full: boolean;
}

export async function fetchQuoteInvoiceBillingContext(quoteId: string): Promise<QuoteInvoiceBillingContext> {
  const res = await apiFetch(
    `${API_BASE}/api/quotes/${encodeURIComponent(quoteId)}/invoice-billing-context`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function createInvoiceFromQuote(
  quoteId: string,
  options?: {
    billingRole?: QuoteBillingRole | string;
    billingAmountTtc?: number;
    preparedTotalTtc?: number;
    preparedTotalHt?: number;
    preparedTotalVat?: number;
  }
): Promise<InvoiceDetail> {
  const body: Record<string, string | number> = {};
  if (options?.billingRole) {
    const apiRole = billingRoleParamToApi(String(options.billingRole));
    if (apiRole) body.billingRole = apiRole;
  }
  if (options?.billingAmountTtc != null && Number.isFinite(Number(options.billingAmountTtc))) {
    body.billingAmountTtc = Number(options.billingAmountTtc);
  }
  if (options?.preparedTotalTtc != null && Number.isFinite(Number(options.preparedTotalTtc))) {
    body.preparedTotalTtc = Number(options.preparedTotalTtc);
  }
  if (options?.preparedTotalHt != null && Number.isFinite(Number(options.preparedTotalHt))) {
    body.preparedTotalHt = Number(options.preparedTotalHt);
  }
  if (options?.preparedTotalVat != null && Number.isFinite(Number(options.preparedTotalVat))) {
    body.preparedTotalVat = Number(options.preparedTotalVat);
  }
  const res = await apiFetch(`${API_BASE}/api/invoices/from-quote/${encodeURIComponent(quoteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function createPreparedStandardInvoiceFromQuote(
  quoteId: string,
  body: {
    preparedLines: Array<{
      label?: string;
      description?: string;
      quantity: number;
      unit_price_ht: number;
      discount_ht?: number;
      vat_rate: number;
      snapshot_json?: Record<string, unknown>;
    }>;
    preparedTotals?: { total_ht?: number; total_vat?: number; total_ttc?: number };
  }
): Promise<InvoiceDetail> {
  const res = await apiFetch(
    `${API_BASE}/api/invoices/from-quote/${encodeURIComponent(quoteId)}/prepared-standard`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Crée un brouillon de devis. `study_id` / `study_version_id` sont facultatifs (devis autonome possible avec seulement `lead_id` ou `client_id`). */
export async function createQuoteDraft(body: {
  client_id?: string;
  lead_id?: string;
  study_id?: string;
  study_version_id?: string;
  items?: unknown[];
  /** Fusionné dans metadata_json côté serveur (ex. study_import). */
  metadata?: Record<string, unknown>;
}): Promise<{ quote: { id: string } }> {
  const res = await apiFetch(`${API_BASE}/api/quotes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Ouverture PDF/document CRM avec JWT — préférer à window.open sur `/api/documents/.../download`. */
export {
  DOCUMENT_ACCESS_DENIED,
  openAuthenticatedDocumentInNewTab,
  resolveCrmApiAbsoluteUrl,
} from "@/utils/documentDownload";
