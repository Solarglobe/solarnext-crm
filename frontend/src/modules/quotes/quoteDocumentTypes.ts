/**
 * Modèle aligné sur buildQuotePdfPayloadFromSnapshot (backend) — source unique pour PDF + Présenter.
 */

export interface QuotePdfDepositDisplay {
  mode?: string;
  percent?: number;
  total_ttc_document?: number;
  amount_ttc?: number;
  note?: string | null;
}

export interface QuotePdfPayload {
  schema_version?: number;
  snapshot_checksum?: string;
  document_type?: string;
  number?: string | null;
  status?: string | null;
  currency?: string;
  sent_at?: string | null;
  valid_until?: string | null;
  notes?: string | null;
  commercial_notes?: string | null;
  technical_notes?: string | null;
  payment_terms?: string | null;
  issuer?: Record<string, unknown>;
  recipient?: Record<string, unknown>;
  lines?: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  refs?: Record<string, unknown>;
  deposit?: Record<string, unknown> | null;
  deposit_display?: QuotePdfDepositDisplay | null;
  pdf_display?: { show_line_pricing?: boolean } | null;
  frozen_at?: string | null;
  /** Paramètre org. (settings_json.quote_pdf.regulatory_text) — hors snapshot */
  regulatory_document_text?: string | null;
}
