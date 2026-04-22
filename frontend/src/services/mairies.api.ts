/**
 * API Mairies / portails DP — GET/POST/PATCH/DELETE /api/mairies
 */
import { apiFetch } from "./api";
import { getCrmApiBase } from "../config/crmApiBase";

function apiRoot(): string {
  const b = getCrmApiBase().replace(/\/$/, "");
  return `${b}/api/mairies`;
}

export type MairiePortalType = "online" | "email" | "paper";
export type MairieAccountStatus = "none" | "to_create" | "created";

export interface MairieDto {
  id: string;
  name: string;
  postal_code: string;
  city: string | null;
  portal_url: string | null;
  portal_type: MairiePortalType;
  account_status: MairieAccountStatus;
  account_email: string | null;
  bitwarden_ref: string | null;
  notes: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  linked_leads_count: number;
}

export interface MairiesListResponse {
  items: MairieDto[];
  page: number;
  limit: number;
  total: number;
}

export interface MairiesListQuery {
  q?: string;
  account_status?: string;
  portal_type?: string;
  postal_code?: string;
  city?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

export type MairieWritePayload = {
  name: string;
  postal_code: string;
  city?: string | null;
  portal_url?: string | null;
  portal_type: MairiePortalType;
  account_status: MairieAccountStatus;
  account_email?: string | null;
  bitwarden_ref?: string | null;
  notes?: string | null;
  last_used_at?: string | null;
};

/** Erreur JSON API (400, 409, etc.) */
export async function readApiErrorJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return { error: res.statusText };
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 400) };
  }
}

export async function fetchMairiesList(query: MairiesListQuery): Promise<MairiesListResponse> {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.account_status) sp.set("account_status", query.account_status);
  if (query.portal_type) sp.set("portal_type", query.portal_type);
  if (query.postal_code) sp.set("postal_code", query.postal_code);
  if (query.city) sp.set("city", query.city);
  if (query.page != null) sp.set("page", String(query.page));
  if (query.limit != null) sp.set("limit", String(query.limit));
  if (query.sort) sp.set("sort", query.sort);
  if (query.order) sp.set("order", query.order);
  const qs = sp.toString();
  const url = qs ? `${apiRoot()}?${qs}` : apiRoot();
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await readApiErrorJson(res);
    throw new Error(String(err.error || "Erreur chargement mairies"));
  }
  return res.json() as Promise<MairiesListResponse>;
}

export async function fetchMairieById(id: string): Promise<MairieDto> {
  const res = await apiFetch(`${apiRoot()}/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const err = await readApiErrorJson(res);
    throw new Error(String(err.error || "Mairie introuvable"));
  }
  return res.json() as Promise<MairieDto>;
}

export async function createMairie(body: MairieWritePayload): Promise<MairieDto> {
  const res = await apiFetch(apiRoot(), {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.ok) {
    return res.json() as Promise<MairieDto>;
  }
  const data = await readApiErrorJson(res);
  const e = new Error(String(data.error || data.message || "Erreur création")) as Error & {
    status?: number;
    payload?: Record<string, unknown>;
  };
  e.status = res.status;
  e.payload = data;
  throw e;
}

export async function updateMairie(id: string, patch: Partial<MairieWritePayload>): Promise<MairieDto> {
  const res = await apiFetch(`${apiRoot()}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (res.ok) {
    return res.json() as Promise<MairieDto>;
  }
  const data = await readApiErrorJson(res);
  const e = new Error(String(data.error || data.message || "Erreur mise à jour")) as Error & {
    status?: number;
    payload?: Record<string, unknown>;
  };
  e.status = res.status;
  e.payload = data;
  throw e;
}

export async function deleteMairie(id: string): Promise<void> {
  const res = await apiFetch(`${apiRoot()}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 204) return;
  const data = await readApiErrorJson(res);
  throw new Error(String(data.error || "Erreur suppression"));
}
