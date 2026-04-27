/**
 * Fiches techniques — API /api/fiche-techniques (pagination + meta serveur).
 */

import { apiFetch } from "./api";
import { getCrmApiBase } from "../config/crmApiBase";
import type {
  FicheTechniqueCategory,
  FicheTechniqueRow,
  FicheTechniqueStatus,
} from "../pages/installation/ficheTechnique.data";
import {
  mapFicheTechniqueUserMessage,
  parseFicheApiErrorJson,
} from "../pages/installation/ficheTechniqueUi";

function apiRoot(): string {
  const b = getCrmApiBase();
  return b ? b.replace(/\/$/, "") : "";
}

export type FicheTechniqueCategoryMeta = { id: string; label: string };

export type FicheTechniqueListItemApi = {
  id: string;
  name: string;
  reference: string;
  brand: string | null;
  category: string;
  status: string;
  file_name: string;
  created_at: string;
  is_favorite: boolean;
  download_url: string;
};

export type FicheTechniquesListResponse = {
  success?: boolean;
  data: FicheTechniqueListItemApi[];
  total: number;
  limit: number;
  offset: number;
};

export type MailAccountListItem = {
  id: string;
  email: string;
  display_name?: string | null;
  is_active?: boolean;
};

export type FetchFicheTechniquesParams = {
  category?: FicheTechniqueCategory | string;
  search?: string;
  brand?: string;
  status?: FicheTechniqueStatus | "all" | string;
  limit?: number;
  offset?: number;
  sort_by?: "name" | "created_at";
  sort_order?: "asc" | "desc";
};

function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError;
}

async function throwMappedApiError(res: Response): Promise<never> {
  const { code } = await parseFicheApiErrorJson(res);
  throw new Error(mapFicheTechniqueUserMessage({ code, httpStatus: res.status }));
}

export function mapListItemToRow(item: FicheTechniqueListItemApi): FicheTechniqueRow {
  return {
    id: item.id,
    name: item.name,
    reference: item.reference,
    brand: item.brand,
    category: item.category as FicheTechniqueCategory,
    status: item.status as FicheTechniqueStatus,
    createdAt: item.created_at,
    isFavorite: item.is_favorite === true,
    downloadUrl: item.download_url,
  };
}

export async function fetchFicheTechniquesMeta(): Promise<FicheTechniqueCategoryMeta[]> {
  const root = apiRoot();
  try {
    const res = await apiFetch(`${root}/api/fiche-techniques/meta`);
    if (!res.ok) await throwMappedApiError(res);
    const data = (await res.json()) as { success?: boolean; categories?: FicheTechniqueCategoryMeta[] };
    return Array.isArray(data.categories) ? data.categories : [];
  } catch (e) {
    if (isNetworkFailure(e)) throw new Error(mapFicheTechniqueUserMessage({ isNetwork: true }));
    throw e;
  }
}

export async function fetchFicheTechniques(params: FetchFicheTechniquesParams): Promise<FicheTechniquesListResponse> {
  const root = apiRoot();
  const q = new URLSearchParams();
  if (params.category) q.set("category", String(params.category));
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.brand?.trim()) q.set("brand", params.brand.trim());
  if (params.status && params.status !== "all") q.set("status", String(params.status));
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.sort_by) q.set("sort_by", params.sort_by);
  if (params.sort_order) q.set("sort_order", params.sort_order);

  const url = `${root}/api/fiche-techniques${q.toString() ? `?${q}` : ""}`;
  try {
    const res = await apiFetch(url);
    if (!res.ok) await throwMappedApiError(res);
    const data = (await res.json()) as FicheTechniquesListResponse;
    return {
      data: Array.isArray(data.data) ? data.data : [],
      total: typeof data.total === "number" ? data.total : 0,
      limit: typeof data.limit === "number" ? data.limit : 20,
      offset: typeof data.offset === "number" ? data.offset : 0,
    };
  } catch (e) {
    if (isNetworkFailure(e)) throw new Error(mapFicheTechniqueUserMessage({ isNetwork: true }));
    throw e;
  }
}

export async function uploadFicheTechnique(formData: FormData): Promise<{ id: string; storage_key: string }> {
  const root = apiRoot();
  try {
    const res = await apiFetch(`${root}/api/fiche-techniques`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) await throwMappedApiError(res);
    return (await res.json()) as { id: string; storage_key: string };
  } catch (e) {
    if (isNetworkFailure(e)) throw new Error(mapFicheTechniqueUserMessage({ isNetwork: true }));
    throw e;
  }
}

export async function patchFicheFavorite(id: string, isFavorite: boolean): Promise<void> {
  const root = apiRoot();
  try {
    const res = await apiFetch(`${root}/api/fiche-techniques/${encodeURIComponent(id)}/favorite`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: isFavorite }),
    });
    if (!res.ok) await throwMappedApiError(res);
  } catch (e) {
    if (isNetworkFailure(e)) throw new Error(mapFicheTechniqueUserMessage({ isNetwork: true }));
    throw e;
  }
}

export async function sendFicheTechniqueEmail(
  id: string,
  body: { to: string; mail_account_id?: string | null },
): Promise<{ success: boolean }> {
  const root = apiRoot();
  try {
    const res = await apiFetch(`${root}/api/fiche-techniques/${encodeURIComponent(id)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: body.to,
        mail_account_id: body.mail_account_id ?? undefined,
      }),
    });
    if (!res.ok) await throwMappedApiError(res);
    return (await res.json()) as { success: boolean };
  } catch (e) {
    if (isNetworkFailure(e)) throw new Error(mapFicheTechniqueUserMessage({ isNetwork: true }));
    throw e;
  }
}

export async function fetchMailAccountsForSend(): Promise<MailAccountListItem[]> {
  const root = apiRoot();
  const res = await apiFetch(`${root}/api/mail/accounts`);
  if (!res.ok) return [];
  const data = (await res.json()) as { success?: boolean; accounts?: MailAccountListItem[] };
  return Array.isArray(data.accounts) ? data.accounts.filter((a) => a.is_active !== false) : [];
}
