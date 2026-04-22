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

/** CGV organisation — aligné sur getLegalCgvForPdfRender (backend). Mode pdf : fusion serveur, pas de bloc HTML. */
export type QuotePdfLegalCgv =
  | { mode: "html"; html: string }
  | { mode: "url"; url: string; qr_data_url?: string | null }
  | { mode: "pdf" };

/** Annexes PDF optionnelles (snapshot / metadata). */
export interface QuotePdfLegalDocuments {
  include_rge: boolean;
  include_decennale: boolean;
}

/** Métadonnées pad « lu et accepté » (persistées sur PNG signature côté serveur). */
export interface QuoteSignatureReadAcceptance {
  accepted?: boolean;
  acceptedLabel?: string | null;
  /** Horodatage serveur officiel (metadata_json.signedAtServer) — prioritaire pour l’affichage */
  signedAtServer?: string | null;
  /** Alias d’affichage : signedAtServer || generated_at (ancien) */
  recordedAt?: string | null;
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
  /** CGV (paramètres org.) — html/url rendus ici ; pdf fusionné côté serveur */
  legal_cgv?: QuotePdfLegalCgv | null;
  /** RGE / décennale : fusion PDF côté serveur uniquement */
  legal_documents?: QuotePdfLegalDocuments | null;
  /** PDF signé / devis accepté : lecture depuis metadata_json des signatures */
  signature_client_read_acceptance?: QuoteSignatureReadAcceptance | null;
  signature_company_read_acceptance?: QuoteSignatureReadAcceptance | null;
}
