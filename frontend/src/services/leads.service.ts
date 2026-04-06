/**
 * CP-035 — Leads Premium Service
 * Tous les appels via apiFetch
 */

import { apiFetch } from "./api";

const API_BASE = import.meta.env?.VITE_API_URL || "";

/** CP-LEAD-CLIENT-SPLIT-06 — Cycle projet (CLIENT uniquement) */
export type ProjectStatus =
  | "SIGNE"
  | "DP_A_DEPOSER"
  | "DP_DEPOSE"
  | "DP_ACCEPTE"
  | "INSTALLATION_PLANIFIEE"
  | "INSTALLATION_REALISEE"
  | "CONSUEL_EN_ATTENTE"
  | "CONSUEL_OBTENU"
  | "MISE_EN_SERVICE"
  | "FACTURATION_TERMINEE"
  | "CLOTURE";

export interface Lead {
  id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  /** PRO : numéro SIRET (14 chiffres) */
  siret?: string | null;
  customer_type?: "PERSON" | "PRO";
  email?: string;
  phone?: string;
  phone_mobile?: string;
  address?: string;
  city?: string;
  site_city?: string;
  site_postal_code?: string;
  site_formatted_address?: string;
  /** Composants chantier (fallback si pas de formatted_address) — aligné fiche lead */
  site_address_line1?: string;
  site_address_line2?: string;
  estimated_kw?: number;
  estimated_budget_eur?: number;
  score: number;
  potential_revenue: number;
  inactivity_level: "none" | "warning" | "danger" | "critical";
  status: "LEAD" | "CLIENT" | "ARCHIVED" | "active" | "signed" | "finalized" | "archived";
  archived_at?: string | null;
  project_status?: ProjectStatus;
  stage_id: string;
  client_id?: string;
  stage_name?: string;
  assigned_to?: string;
  assigned_salesperson_user_id?: string;
  assigned_to_email?: string;
  lead_source?: string;
  is_geo_verified?: boolean;
  has_signed_quote?: boolean;
  /** Dernière date de passage en « signed » sur un devis (MAX quotes.updated_at) */
  quote_signed_at?: string | null;
  /** Si exposé par l’API — sinon fallback quote_signed_at / updated_at côté UI */
  signed_at?: string | null;
  created_at: string;
  updated_at?: string;
  last_activity_at?: string;
  lost_reason?: string | null;
}

export interface LeadsFilters {
  view?: "leads" | "clients";
  stage?: string;
  assigned_to?: string;
  search?: string;
  page?: number;
  limit?: number;
  date_from?: string;
  date_to?: string;
  from_date?: string;
  to_date?: string;
  project_status?: ProjectStatus;
  budget_min?: number;
  budget_max?: number;
  is_geo_verified?: boolean;
  has_signed_quote?: boolean;
  sort?: "full_name" | "updated_at" | "assigned_salesperson_user_id" | "project_status" | "estimated_budget_eur";
  order?: "asc" | "desc";
  /** Liste uniquement : inclure les leads archivés (status ARCHIVED) */
  include_archived?: boolean;
}

export interface KanbanColumn {
  stage_id: string;
  stage_name: string;
  leads: Lead[];
}

/** Filtres Kanban alignés sur GET /api/leads (recherche, stage, commercial) */
export type KanbanFetchFilters = Pick<
  LeadsFilters,
  "search" | "stage" | "assigned_to"
>;

export async function fetchKanban(
  filters?: KanbanFetchFilters
): Promise<KanbanColumn[]> {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.stage) params.set("stage", filters.stage);
  if (filters?.assigned_to) params.set("assigned_to", filters.assigned_to);
  const qs = params.toString();
  const url = `${API_BASE}/api/leads/kanban${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const data = await res.json();
  return data.columns ?? [];
}

export async function fetchLeads(filters?: LeadsFilters): Promise<Lead[]> {
  const params = new URLSearchParams();
  params.set("view", filters?.view ?? "leads");
  if (filters?.stage) params.set("stage", filters.stage);
  if (filters?.assigned_to) params.set("assigned_to", filters.assigned_to);
  if (filters?.search) params.set("search", filters.search);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.date_from) params.set("date_from", filters.date_from);
  if (filters?.date_to) params.set("date_to", filters.date_to);
  if (filters?.from_date) params.set("from_date", filters.from_date);
  if (filters?.to_date) params.set("to_date", filters.to_date);
  if (filters?.project_status) params.set("project_status", filters.project_status);
  if (filters?.budget_min != null) params.set("budget_min", String(filters.budget_min));
  if (filters?.budget_max != null) params.set("budget_max", String(filters.budget_max));
  if (filters?.is_geo_verified !== undefined) params.set("is_geo_verified", String(filters.is_geo_verified));
  if (filters?.has_signed_quote !== undefined) params.set("has_signed_quote", String(filters.has_signed_quote));
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.order) params.set("order", filters.order);

  const qs = params.toString();
  const url = `${API_BASE}/api/leads${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function archiveLead(id: string): Promise<Lead> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}/archive`, { method: "PATCH" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function unarchiveLead(id: string): Promise<Lead> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}/unarchive`, { method: "PATCH" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function deleteLead(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
}

export async function updateLeadStage(leadId: string, stageId: string): Promise<{ stage: { id: string; name: string } }> {
  const res = await apiFetch(`${API_BASE}/api/leads/${leadId}/stage`, {
    method: "PATCH",
    body: JSON.stringify({ stageId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** PATCH /api/leads/:id — même usage que la fiche Lead (project_status, etc.) */
export async function updateLead(
  payload: { id: string | number } & Partial<Omit<Lead, "id">>
): Promise<Lead> {
  const { id, ...body } = payload;
  const res = await apiFetch(`${API_BASE}/api/leads/${String(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return (await res.json()) as Lead;
}

export function getLeadName(lead: Lead): string {
  if (lead.full_name?.trim()) return lead.full_name.trim();
  const parts = [lead.first_name, lead.last_name].filter(Boolean);
  return parts.join(" ").trim() || "Sans nom";
}

export function getLeadCity(lead: Lead): string {
  if (lead.site_city) return lead.site_city;
  if (lead.city) return lead.city;
  if (lead.address) {
    const parts = String(lead.address).split(",");
    return parts[parts.length - 1]?.trim() || "—";
  }
  return "—";
}

/** Ligne « projet » pour cartes / liste (statut cycle, source, etc.) */
export function getLeadProjectHint(lead: Lead): string {
  if (lead.project_status)
    return String(lead.project_status).replace(/_/g, " ");
  if (lead.lead_source?.trim()) return lead.lead_source.trim();
  return "";
}

/**
 * Adresse complète — même logique que la fiche (Overview) :
 * formatted_address chantier, sinon lignes + CP + ville, sinon address libre.
 */
export function getLeadFullAddress(lead: Lead): string {
  const formatted = lead.site_formatted_address?.trim();
  if (formatted) return formatted;
  const parts = [
    lead.site_address_line1,
    lead.site_address_line2,
    lead.site_postal_code,
    lead.site_city,
  ]
    .filter((p): p is string => Boolean(p && String(p).trim()))
    .map((p) => String(p).trim());
  if (parts.length) return parts.join(", ");
  const free = lead.address?.trim();
  if (free) return free;
  return "";
}

/** Téléphone mobile ou fixe */
export function getLeadPhoneDisplay(lead: Lead): string {
  const m = lead.phone_mobile?.trim();
  const p = lead.phone?.trim();
  if (m) return m;
  if (p) return p;
  return "";
}

export function formatPotentialRevenue(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export interface LeadsMeta {
  stages: {
    id: string;
    name: string;
    position?: number;
    is_closed?: boolean;
    code?: string | null;
  }[];
  users: { id: string; email?: string }[];
}

export async function fetchLeadsMeta(): Promise<LeadsMeta> {
  const res = await apiFetch(`${API_BASE}/api/leads/meta`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export interface CreateLeadPayload {
  customer_type?: "PERSON" | "PRO";
  // PERSON
  firstName?: string;
  lastName?: string;
  // PRO
  companyName?: string;
  contactFirstName?: string;
  contactLastName?: string;
  // Commun
  phone?: string;
  email?: string;
}

export async function createLead(payload: CreateLeadPayload): Promise<Lead> {
  const isPro = payload.customer_type === "PRO";
  const body = {
    customer_type: payload.customer_type ?? "PERSON",
    first_name: isPro ? undefined : (payload.firstName?.trim() || undefined),
    last_name: isPro ? undefined : (payload.lastName?.trim() || undefined),
    company_name: isPro ? (payload.companyName?.trim() || undefined) : undefined,
    contact_first_name: isPro ? (payload.contactFirstName?.trim() || undefined) : undefined,
    contact_last_name: isPro ? (payload.contactLastName?.trim() || undefined) : undefined,
    phone: payload.phone?.trim() || undefined,
    email: payload.email?.trim() || undefined,
  };
  const res = await apiFetch(`${API_BASE}/api/leads`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** CP-CONVERT — Convertit un lead en client (crée l'enregistrement client, génère SG-YYYY-XXXX) */
export async function convertLead(id: string): Promise<{ client: unknown; lead: Lead }> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}/convert`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}
