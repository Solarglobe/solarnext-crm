/**
 * Types suivi financier facture — alignés API backend (payments / credit_notes / invoice_reminders).
 */

export type PaymentMethodUi = "virement" | "carte" | "cheque" | "especes" | "autre";

/** Canal relance — backend : PHONE | EMAIL | LETTER | OTHER */
export type ReminderChannelApi = "PHONE" | "EMAIL" | "LETTER" | "OTHER";

export interface InvoicePaymentApi {
  id: string;
  amount: number | string;
  payment_date?: string;
  payment_method?: string | null;
  reference?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string;
  cancelled_at?: string | null;
}

export interface InvoiceCreditNoteApi {
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

export interface InvoiceReminderApi {
  id: string;
  reminded_at: string;
  channel: string;
  note?: string | null;
  next_action_at?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface InvoiceBalanceSnapshot {
  total_ttc: number;
  total_paid: number;
  total_credited: number;
  amount_due: number;
}
