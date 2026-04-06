/**
 * Modèle facture — aligné API backend (statuts DB en UPPERCASE, affichage métier via helpers).
 */

export type InvoiceLineType = "catalog" | "custom";

export interface InvoiceLine {
  id: string;
  type: InvoiceLineType;
  catalog_item_id?: string | null;
  label: string;
  quantity: number;
  unit_price_ht: number;
  tva_percent: number;
  line_discount_percent: number;
  position: number;
}

/** Statuts affichage (UX) — overdue peut être dérivé (échéance + solde). */
export type InvoiceStatusUi = "draft" | "sent" | "partial" | "paid" | "cancelled" | "overdue";

export interface InvoiceTotals {
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  total_paid?: number;
  total_due?: number;
}

export interface InvoiceHeaderSnapshot {
  id: string;
  invoice_number: string;
  lead_id: string | null;
  client_id: string | null;
  quote_id: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string;
  currency: string;
  /** Affichage secondaire */
  client_label?: string | null;
  lead_label?: string | null;
}

export interface InvoiceBuilderMeta {
  notes: string;
  payment_terms: string;
}
