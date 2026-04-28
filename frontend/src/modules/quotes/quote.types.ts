/**
 * Modèle builder devis commercial — aligné API PATCH /api/quotes/:id (items, metadata).
 */

export type QuoteLineType = "catalog" | "custom";

/** Origine de la ligne : import étude (remplaçable par « mise à jour depuis l’étude ») vs manuel. */
export type QuoteLineSource = "study_prep" | "manual";

export interface QuoteLine {
  id: string;
  type: QuoteLineType;
  /** Présent si type === catalog */
  catalog_item_id?: string | null;
  /** Lignes `study_prep` sont remplacées à l’import / mise à jour depuis l’étude ; le reste est préservé. */
  line_source?: QuoteLineSource;
  label: string;
  /** Détail affichable sur le devis client (mode document condensé). */
  description?: string;
  /** Référence article figée dans le snapshot de ligne. */
  reference?: string;
  quantity: number;
  unit_price_ht: number;
  /** % TVA (0, 5.5, 10, 20) */
  tva_percent: number;
  /** Remise ligne % sur base HT brute (avant TVA) */
  line_discount_percent: number;
  position: number;
  /** Centimes HT / unité — présent si ligne catalogue avec coût (GET quote_lines). */
  purchase_unit_price_ht_cents?: number | null;
  /** Type métier snapshot (ex. DOCUMENT_DISCOUNT). */
  line_kind?: string | null;
}

export interface QuoteTotals {
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  /** Sous-totaux lignes avant remise globale */
  subtotal_ht: number;
  subtotal_tva: number;
  subtotal_ttc: number;
  /** Montant HT de remise document appliqué (après calcul) */
  applied_global_discount_ht: number;
}

/** Acompte structuré (metadata_json.deposit) — PERCENT = % du TTC document, AMOUNT = montant TTC fixe */
export type QuoteDepositType = "PERCENT" | "AMOUNT";

export interface QuoteDeposit {
  type: QuoteDepositType;
  /** PERCENT : 0–100 du TTC ; AMOUNT : € TTC */
  value: number;
  note?: string;
}

/** Traçabilité import étude (metadata_json.study_import) — pas de synchro automatique. */
export interface QuoteStudyImportMeta {
  last_at?: string | null;
  study_version_id?: string | null;
}

export interface QuoteBuilderMeta {
  validity_days: number;
  deposit: QuoteDeposit;
  notes: string;
  commercial_notes: string;
  technical_notes: string;
  /** Modalités de paiement visibles sur le PDF (metadata_json.payment_terms). */
  payment_terms: string;
  study_import?: QuoteStudyImportMeta | null;
  /** metadata_json.pdf_show_line_pricing — défaut true. */
  pdf_show_line_pricing: boolean;
  /** Annexes légales PDF (metadata_json.legal_documents) — fusion serveur si coché. */
  legal_documents: {
    include_rge: boolean;
    include_decennale: boolean;
  };
}

export interface QuoteHeaderSnapshot {
  id: string;
  quote_number: string;
  status: string;
  lead_id?: string | null;
  client_id?: string | null;
  study_id?: string | null;
  study_version_id?: string | null;
  valid_until?: string | null;
  /** Affichage builder : raison sociale ou contact (JOIN client ou customer_snapshot). */
  client_display?: string | null;
}
