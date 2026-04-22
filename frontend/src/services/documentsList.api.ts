/**
 * Document Center — liste globale organisation (GET /api/documents).
 */

import { apiFetch } from "./api";
import { getCrmApiBase } from "../config/crmApiBase";

function apiRoot(): string {
  const b = getCrmApiBase();
  return b ? b.replace(/\/$/, "") : "";
}

export type OrganizationDocumentListItem = {
  id: string;
  entity_type: string;
  entity_id: string;
  document_type: string | null;
  document_category: string | null;
  documentCategory?: string | null;
  display_name: string | null;
  displayName?: string | null;
  file_name: string;
  mime_type: string;
  created_at: string;
  lead_id: string | null;
  lead_name: string | null;
  client_name: string | null;
  download_url?: string;
  is_visible_to_client?: boolean;
  isClientVisible?: boolean;
};

export type OrganizationDocumentsListResponse = {
  success?: boolean;
  documents: OrganizationDocumentListItem[];
  total: number;
  limit: number;
  offset: number;
};

const EMPTY_RESPONSE = (): OrganizationDocumentsListResponse => ({
  success: false,
  documents: [],
  total: 0,
  limit: 50,
  offset: 0,
});

export async function fetchOrganizationDocuments(params: {
  search?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<OrganizationDocumentsListResponse> {
  const q = new URLSearchParams();
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.type && params.type !== "all") q.set("type", params.type);
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  const url = `${apiRoot()}/api/documents${qs ? `?${qs}` : ""}`;

  try {
    const res = await apiFetch(url);
    const text = await res.text();
    if (!res.ok) {
      console.error("fetchOrganizationDocuments HTTP", res.status, text);
      return EMPTY_RESPONSE();
    }
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      console.error("fetchOrganizationDocuments invalid JSON");
      return EMPTY_RESPONSE();
    }
    const o = data as Record<string, unknown>;
    if (o.success === false) {
      console.error("fetchOrganizationDocuments success:false", o);
      return EMPTY_RESPONSE();
    }
    const documents = Array.isArray(o.documents) ? (o.documents as OrganizationDocumentListItem[]) : [];
    const total = typeof o.total === "number" ? o.total : documents.length;
    const limit = typeof o.limit === "number" ? o.limit : params.limit ?? 50;
    const offset = typeof o.offset === "number" ? o.offset : params.offset ?? 0;
    return {
      success: o.success !== false,
      documents,
      total,
      limit,
      offset,
    };
  } catch (e) {
    console.error("fetchOrganizationDocuments error", e);
    return EMPTY_RESPONSE();
  }
}
