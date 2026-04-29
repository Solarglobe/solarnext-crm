/**
 * CP-036 — Service Devis (Hub Client)
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

export interface Quote {
  id: string;
  quote_number: string;
  status: string;
  total_ht?: number;
  total_vat?: number;
  total_ttc?: number;
  document_snapshot_json?: {
    totals?: {
      total_ht?: number | string | null;
      total_vat?: number | string | null;
      total_ttc?: number | string | null;
    } | null;
  } | string | null;
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

type QuoteTotalsSource = {
  total_ht?: unknown;
  total_vat?: unknown;
  total_ttc?: unknown;
  document_snapshot_json?: unknown;
};

function moneyNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseSnapshotTotals(q: QuoteTotalsSource): { total_ht?: number; total_vat?: number; total_ttc?: number } | null {
  const raw = q.document_snapshot_json;
  if (!raw) return null;
  let snapshot: unknown = raw;
  if (typeof raw === "string") {
    try {
      snapshot = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!snapshot || typeof snapshot !== "object") return null;
  const totals = (snapshot as { totals?: Record<string, unknown> | null }).totals;
  if (!totals || typeof totals !== "object") return null;
  const total_ttc = Number(totals.total_ttc);
  if (!Number.isFinite(total_ttc)) return null;
  const total_ht = Number(totals.total_ht);
  const total_vat = Number(totals.total_vat);
  return {
    total_ttc,
    ...(Number.isFinite(total_ht) ? { total_ht } : {}),
    ...(Number.isFinite(total_vat) ? { total_vat } : {}),
  };
}

export function quoteDisplayTotals(q: QuoteTotalsSource): { total_ht: number; total_vat: number; total_ttc: number } {
  const snap = parseSnapshotTotals(q);
  return {
    total_ht: snap?.total_ht ?? moneyNumber(q.total_ht),
    total_vat: snap?.total_vat ?? moneyNumber(q.total_vat),
    total_ttc: snap?.total_ttc ?? moneyNumber(q.total_ttc),
  };
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
