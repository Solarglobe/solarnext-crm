/**
 * Envoi email groupé — POST /api/mail/bulk-send
 */

import { apiFetch } from "./api";
import type { LeadsFilters } from "./leads.service";

const API_BASE = import.meta.env?.VITE_API_URL || "";

const MAX_BULK_LEAD_IDS = 200;

/** Filtres alignés sur GET /api/leads (+ option `lead_ids` pour cibler une sélection). */
export function buildBulkFiltersPayload(
  filters: LeadsFilters,
  selectedLeadIds?: string[] | null
): Record<string, unknown> {
  const view = filters.view === "clients" ? "clients" : "leads";
  const out: Record<string, unknown> = {
    view,
  };
  const copyKeys: (keyof LeadsFilters)[] = [
    "stage",
    "assigned_to",
    "search",
    "include_archived",
    "archive_scope",
    "date_from",
    "date_to",
    "from_date",
    "to_date",
    "has_signed_quote",
    "source_id",
    "created_from",
    "created_to",
    "marketing_opt_in",
    "project_status",
    "budget_min",
    "budget_max",
    "is_geo_verified",
  ];
  for (const k of copyKeys) {
    const v = filters[k];
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  if (selectedLeadIds && selectedLeadIds.length > 0) {
    const ids = [
      ...new Set(
        selectedLeadIds.map((id) => String(id).trim()).filter((s) => s.length > 0)
      ),
    ].slice(0, MAX_BULK_LEAD_IDS);
    if (ids.length > 0) {
      out.lead_ids = ids;
    }
  }
  return out;
}

export async function postBulkSendPreview(filters: Record<string, unknown>): Promise<{ count: number }> {
  const res = await apiFetch(`${API_BASE}/api/mail/bulk-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters, preview: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const data = (await res.json()) as { count?: number };
  return { count: data.count ?? 0 };
}

export async function postBulkSend(body: {
  filters: Record<string, unknown>;
  subject: string;
  html: string;
}): Promise<{ queued: number; total: number; errors?: { email: string; message: string }[] }> {
  const res = await apiFetch(`${API_BASE}/api/mail/bulk-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, preview: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json() as Promise<{
    queued: number;
    total: number;
    errors?: { email: string; message: string }[];
  }>;
}
