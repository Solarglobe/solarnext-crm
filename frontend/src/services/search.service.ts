/**
 * Recherche globale CRM — GET /api/search/global
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

export interface GlobalSearchHit {
  type: "lead" | "client";
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
}

export async function fetchGlobalSearch(q: string, signal?: AbortSignal): Promise<GlobalSearchHit[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const params = new URLSearchParams({ q: trimmed });
  const res = await apiFetch(`${API_BASE}/api/search/global?${params.toString()}`, { signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}
