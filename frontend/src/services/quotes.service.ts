/**
 * CP-036 — Service Devis (Hub Client)
 */

import { apiFetch } from "./api";

const API_BASE = import.meta.env?.VITE_API_URL || "";

export interface Quote {
  id: string;
  quote_number: string;
  status: string;
  total_ht?: number;
  total_vat?: number;
  total_ttc?: number;
  lead_id?: string;
  client_id?: string | null;
  study_id?: string | null;
  valid_until?: string | null;
  has_pdf?: boolean;
  /** Présent sur les listes devis (ex. lead) — document quote_pdf_signed */
  has_signed_pdf?: boolean;
  created_at: string;
  updated_at?: string;
}

export async function fetchQuotesByLeadId(leadId: string): Promise<Quote[]> {
  const res = await apiFetch(`${API_BASE}/api/quotes?lead_id=${encodeURIComponent(leadId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchQuotesByStudyId(studyId: string): Promise<Quote[]> {
  const res = await apiFetch(`${API_BASE}/api/quotes?study_id=${encodeURIComponent(studyId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}
