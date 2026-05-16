/**
 * CP-035 — Leads Premium Service
 * Tous les appels via apiFetch
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

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
  /** ISO YYYY-MM-DD — mandat de représentation DP */
  birth_date?: string | null;
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
  /** Statut commercial CRM (LEAD, NEW, QUALIFIED, CLIENT, LOST, …) */
  status: string;
  archived_at?: string | null;
  project_status?: ProjectStatus;
  stage_id: string;
  client_id?: string;
  stage_name?: string;
  /** Filtre API inchangé (UUID commercial) */
  assigned_to?: string;
  assigned_user_id?: string;
  assigned_to_email?: string;
  source_id?: string;
  /** Nom catalogue lead_sources (jointure API) */
  source_name?: string;
  /** Slug stable d’acquisition (jointure API) — pour stats / ROI */
  source_slug?: string | null;
  /** @deprecated préférer source_name — texte libre legacy si colonne DB encore présente */
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
  rgpd_consent?: boolean;
  rgpd_consent_at?: string | null;
  marketing_opt_in?: boolean;
  marketing_opt_in_at?: string | null;
  /** CP-MAIRIES-004 — lien mairie (GET liste / détail enrichi) */
  mairie_id?: string | null;
  /** Statut compte portail mairie liée — sinon absent / null */
  mairie_account_status?: "none" | "to_create" | "created" | null;
  /** Détails GET /api/leads/:id seulement (jointure) */
  mairie_name?: string | null;
  mairie_postal_code?: string | null;
  mairie_city?: string | null;
  mairie_portal_url?: string | null;
  mairie_portal_type?: "online" | "email" | "paper" | null;
  mairie_account_email?: string | null;
  mairie_bitwarden_ref?: string | null;
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
  /** Filtre sur la date de création du dossier (YYYY-MM-DD) */
  created_from?: string;
  created_to?: string;
  /** Source d’acquisition (UUID) */
  source_id?: string;
  /** Opt-in marketing (table leads) */
  marketing_opt_in?: boolean;
  sort?:
    | "full_name"
    | "updated_at"
    | "created_at"
    | "assigned_user_id"
    | "assigned_salesperson_user_id"
    | "project_status"
    | "estimated_budget_eur"
    | "score"
    | "inactivity_level"
    | "stage_name";
  order?: "asc" | "desc";
  /** @deprecated préférer archive_scope — liste leads/clients */
  include_archived?: boolean;
  /** Filtre archivage : actifs ( défaut ), archivés seuls, ou tous */
  archive_scope?: "active" | "archived" | "all";
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

function leadsQueryParams(filters?: LeadsFilters, extra?: Record<string, string>): URLSearchParams {
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
  if (filters?.created_from) params.set("created_from", filters.created_from);
  if (filters?.created_to) params.set("created_to", filters.created_to);
  if (filters?.source_id) params.set("source_id", filters.source_id);
  if (filters?.marketing_opt_in !== undefined) {
    params.set("marketing_opt_in", String(filters.marketing_opt_in));
  }
  const scope = filters?.archive_scope;
  if (scope === "archived" || scope === "all") {
    params.set("archive_scope", scope);
  } else if (scope === "active") {
    params.set("archive_scope", "active");
  } else if (filters?.include_archived === true) {
    params.set("include_archived", "true");
  }
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.order) params.set("order", filters.order);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      params.set(k, v);
    }
  }
  return params;
}

export async function fetchLeads(filters?: LeadsFilters): Promise<Lead[]> {
  const params = leadsQueryParams(filters);
  const qs = params.toString();
  const url = `${API_BASE}/api/leads${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data as Lead[];
  if (data && typeof data === "object" && Array.isArray((data as { leads?: unknown }).leads)) {
    return (data as { leads: Lead[] }).leads;
  }
  return [];
}

/** GET /api/leads avec `include_total` — pagination serveur (total filtré). */
export async function fetchLeadsWithTotal(
  filters?: LeadsFilters
): Promise<{ leads: Lead[]; total: number }> {
  const params = leadsQueryParams(filters, { include_total: "true" });
  const qs = params.toString();
  const url = `${API_BASE}/api/leads${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const data = await res.json();
  if (data && typeof data === "object" && Array.isArray((data as { leads?: unknown }).leads)) {
    return {
      leads: (data as { leads: Lead[] }).leads,
      total: Number((data as { total?: unknown }).total) || 0,
    };
  }
  if (Array.isArray(data)) {
    const rows = data as Lead[];
    return { leads: rows, total: rows.length };
  }
  return { leads: [], total: 0 };
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

export function isLeadArchivedRecord(lead: Pick<Lead, "status" | "archived_at">): boolean {
  return lead.status === "ARCHIVED" || Boolean(lead.archived_at);
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
  const src = lead.source_name?.trim() || lead.lead_source?.trim();
  if (src) return src;
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

/** Libellé compact pour liste (CP + ville, ou 1re ligne d’adresse courte) — évite le pavé complet. */
export function getLeadListLocation(lead: Lead): string {
  const pc = lead.site_postal_code?.trim();
  const city = lead.site_city?.trim() || lead.city?.trim();
  if (pc && city) return `${pc} ${city}`;
  if (city) return city;
  if (pc) return pc;
  const full = getLeadFullAddress(lead);
  if (!full) return "";
  const firstLine = full.split(",")[0]?.trim() ?? "";
  if (firstLine.length > 48) return `${firstLine.slice(0, 45)}…`;
  return firstLine;
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

export type LeadAcquisitionCategory =
  | "field"
  | "digital_owned"
  | "digital_paid"
  | "organic"
  | "offline"
  | "events"
  | "referral"
  | "partner"
  | "inbound"
  | "platform"
  | "other";

export interface LeadsMeta {
  stages: {
    id: string;
    name: string;
    position?: number;
    is_closed?: boolean;
    code?: string | null;
  }[];
  users: { id: string; email?: string }[];
  sources: {
    id: string;
    name: string;
    slug?: string;
    sort_order?: number;
    category?: LeadAcquisitionCategory;
  }[];
}

export async function fetchLeadsMeta(): Promise<LeadsMeta> {
  const res = await apiFetch(`${API_BASE}/api/leads/meta`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const data = (await res.json()) as Partial<LeadsMeta>;
  return {
    stages: data.stages ?? [],
    users: data.users ?? [],
    sources: data.sources ?? [],
  };
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

/** CP-CONVERT — Convertit un lead en client (crée l'enregistrement client, génère SG-YYYY-XXXX). Refuse si déjà lié. */
export async function convertLead(id: string): Promise<{ client: unknown; lead: Lead }> {
  const res = await apiFetch(`${API_BASE}/api/leads/${encodeURIComponent(id)}/convert`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Conversion manuelle idempotente : crée le client si besoin, sinon renvoie le client déjà lié. */
export async function convertLeadToClient(
  id: string
): Promise<{ client: unknown; lead: Lead; already_converted?: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/leads/${encodeURIComponent(id)}/convert-to-client`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Remet un dossier CLIENT en LEAD (supprime la fiche client si aucune facture / avoir). */
export async function revertLeadToLead(id: string): Promise<{ ok: boolean; lead_id: string }> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}/revert-to-lead`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Nombre d'éléments liés à un lead (pour DeleteConfirmModal). */
export interface LeadLinkedCounts {
  studies: number;
  quotes: number;
  invoices: number;
  documents: number;
}

export async function fetchLeadLinkedCounts(id: string): Promise<LeadLinkedCounts> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}/linked`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Soft-delete d'un lead (PII anonymisées, 30 jours de grâce). */
export async function deleteLead(id: string): Promise<{ deleted: boolean; id: string; deleted_at: string }> {
  const res = await apiFetch(`${API_BASE}/api/leads/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}
