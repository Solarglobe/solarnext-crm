/**
 * CP-ADMIN-UI-03 — API Admin
 * Appels vers les endpoints admin existants (aucun modifié).
 */

import { buildApiUrl } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const BASE = "/api/admin";
const apiUrl = (path: string) => buildApiUrl(path);

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return data as T;
}

// --- Users ---
export interface AdminUser {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  /** Présent si le backend expose un nom affichable (sinon utiliser email côté UI). */
  name?: string | null;
  status: string;
  roles?: string[];
  last_login?: string;
  created_at?: string;
}

export async function adminGetUsers(): Promise<AdminUser[]> {
  const res = await apiFetch(apiUrl(`${BASE}/users`));
  return handleResponse<AdminUser[]>(res);
}

export async function adminCreateUser(body: {
  email: string;
  password: string;
  first_name?: string | null;
  last_name?: string | null;
  roleIds?: string[];
}): Promise<AdminUser> {
  const res = await apiFetch(apiUrl(`${BASE}/users`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminUser>(res);
}

export async function adminUpdateUser(
  id: string,
  body: {
    email?: string;
    password?: string;
    status?: string;
    first_name?: string | null;
    last_name?: string | null;
    roleIds?: string[];
  }
): Promise<AdminUser> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminUser>(res);
}

export async function adminDeleteUser(id: string): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${id}`), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
}

export type AdminUserImpersonateResponse = {
  token: string;
  expiresInSec: number;
  user: {
    id: string;
    name: string;
    email: string;
    organizationId: string;
    organizationName: string;
  };
};

/** SUPER_ADMIN — jeton d’impersonation « en tant que » utilisateur (RBAC réel). */
export async function adminImpersonateUser(userId: string): Promise<AdminUserImpersonateResponse> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${userId}/impersonate`), { method: "POST" });
  return handleResponse<AdminUserImpersonateResponse>(res);
}

export interface UserTeam {
  id: string;
  team_id: string;
  team_name: string;
  agency_name?: string;
}

export async function adminGetUserTeams(userId: string): Promise<UserTeam[]> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${userId}/teams`));
  return handleResponse<UserTeam[]>(res);
}

export async function adminPutUserTeams(
  userId: string,
  teamIds: string[]
): Promise<UserTeam[]> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${userId}/teams`), {
    method: "PUT",
    body: JSON.stringify({ teamIds }),
  });
  return handleResponse<UserTeam[]>(res);
}

export interface UserAgency {
  id: string;
  agency_id: string;
  agency_name: string;
}

export async function adminGetUserAgencies(userId: string): Promise<UserAgency[]> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${userId}/agencies`));
  return handleResponse<UserAgency[]>(res);
}

export async function adminPutUserAgencies(
  userId: string,
  agencyIds: string[]
): Promise<UserAgency[]> {
  const res = await apiFetch(apiUrl(`${BASE}/users/${userId}/agencies`), {
    method: "PUT",
    body: JSON.stringify({ agencyIds }),
  });
  return handleResponse<UserAgency[]>(res);
}

// --- Roles ---
export interface AdminRole {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  organization_id?: string;
}

export async function adminGetRoles(): Promise<AdminRole[]> {
  const res = await apiFetch(apiUrl(`${BASE}/roles`));
  return handleResponse<AdminRole[]>(res);
}

export interface AdminPermission {
  id: string;
  code: string;
  module: string;
  description?: string;
}

export async function adminGetRolePermissions(roleId: string): Promise<AdminPermission[]> {
  const res = await apiFetch(apiUrl(`${BASE}/roles/${roleId}/permissions`));
  return handleResponse<AdminPermission[]>(res);
}

export async function adminPutRolePermissions(
  roleId: string,
  permissionIds: string[]
): Promise<AdminPermission[]> {
  const res = await apiFetch(apiUrl(`${BASE}/roles/${roleId}/permissions`), {
    method: "PUT",
    body: JSON.stringify({ permissionIds }),
  });
  return handleResponse<AdminPermission[]>(res);
}

export async function adminGetAllPermissions(): Promise<AdminPermission[]> {
  const res = await apiFetch(apiUrl(`${BASE}/permissions`));
  return handleResponse<AdminPermission[]>(res);
}

// --- Agencies ---
export interface AdminAgency {
  id: string;
  name: string;
  organization_id?: string;
  created_at?: string;
}

export async function adminGetAgencies(): Promise<AdminAgency[]> {
  const res = await apiFetch(apiUrl(`${BASE}/agencies`));
  return handleResponse<AdminAgency[]>(res);
}

export async function adminCreateAgency(body: { name: string }): Promise<AdminAgency> {
  const res = await apiFetch(apiUrl(`${BASE}/agencies`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminAgency>(res);
}

export async function adminUpdateAgency(
  id: string,
  body: { name: string }
): Promise<AdminAgency> {
  const res = await apiFetch(apiUrl(`${BASE}/agencies/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminAgency>(res);
}

export async function adminDeleteAgency(id: string): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/agencies/${id}`), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
}

// --- Teams ---
export interface AdminTeam {
  id: string;
  name: string;
  agency_id?: string;
  agency_name?: string;
  organization_id?: string;
}

export async function adminGetTeams(): Promise<AdminTeam[]> {
  const res = await apiFetch(apiUrl(`${BASE}/teams`));
  return handleResponse<AdminTeam[]>(res);
}

export async function adminCreateTeam(body: {
  name: string;
  agency_id?: string;
}): Promise<AdminTeam> {
  const res = await apiFetch(apiUrl(`${BASE}/teams`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminTeam>(res);
}

export async function adminUpdateTeam(
  id: string,
  body: { name: string; agency_id?: string }
): Promise<AdminTeam> {
  const res = await apiFetch(apiUrl(`${BASE}/teams/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminTeam>(res);
}

export async function adminDeleteTeam(id: string): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/teams/${id}`), { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
}

// --- Organization (CP-ADMIN-ORG-04) ---
export interface AdminOrg {
  id: string;
  name: string;
  settings_json?: Record<string, unknown>;
  created_at?: string;
  legal_name?: string;
  trade_name?: string;
  siret?: string;
  vat_number?: string;
  rcs?: string;
  capital_amount?: string;
  address_line1?: string;
  address_line2?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  iban?: string;
  bic?: string;
  bank_name?: string;
  default_payment_terms?: string;
  default_invoice_notes?: string;
  default_quote_validity_days?: number;
  default_invoice_due_days?: number;
  default_vat_rate?: number;
  quote_prefix?: string;
  invoice_prefix?: string;
  logo_url?: string;
  logo_dark_url?: string;
  pdf_primary_color?: string | null;
  pdf_secondary_color?: string | null;
  pdf_cover_image_key?: string;
}

export type AdminOrgUpdate = Partial<Omit<AdminOrg, "id" | "created_at">>;

export async function adminGetOrg(): Promise<AdminOrg> {
  const res = await apiFetch(apiUrl(`${BASE}/org`));
  return handleResponse<AdminOrg>(res);
}

export async function adminUpdateOrg(body: AdminOrgUpdate): Promise<AdminOrg> {
  const res = await apiFetch(apiUrl(`${BASE}/org`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<AdminOrg>(res);
}

export async function adminUploadLogo(file: File): Promise<{ logo_url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(apiUrl(`${BASE}/org/logo`), {
    method: "POST",
    body: formData,
  });
  return handleResponse<{ logo_url: string }>(res);
}

export async function adminDeleteLogo(): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/org/logo`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
}

export async function adminUploadPdfCover(file: File, orgId: string): Promise<{ storage_key: string }> {
  const formData = new FormData();
  formData.append("entityType", "organization");
  formData.append("entityId", orgId);
  formData.append("document_type", "organization_pdf_cover");
  formData.append("file", file);
  const res = await apiFetch(apiUrl("/api/documents"), {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  if (!data.storage_key) throw new Error("Réponse upload invalide");
  return { storage_key: data.storage_key };
}

export async function adminDeletePdfCover(): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/org/pdf-cover`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erreur ${res.status}`);
  }
}

// --- Paramètres spécifiques PV (organization.settings_json) ---
export interface OrgPvSettings {
  pricing?: {
    kit_panel_power_w?: number;
    kit_price_lt_4_5?: number;
    kit_price_gt_4_5?: number;
    coffret_mono_ht?: number;
    coffret_tri_ht?: number;
    battery_unit_kwh?: number;
    battery_unit_price_ht?: number;
    install_tiers?: { kwc: number; price_ht: number }[];
  };
  economics?: {
    price_eur_kwh?: number;
    elec_growth_pct?: number;
    pv_degradation_pct?: number;
    horizon_years?: number;
    oa_rate_lt_9?: number;
    oa_rate_gte_9?: number;
    prime_lt9?: number;
    prime_gte9?: number;
    maintenance_pct?: number;
    onduleur_year?: number;
    onduleur_cost_pct?: number;
    /** Dégradation annuelle contribution batterie physique dans les cashflows (%) */
    battery_degradation_pct?: number;
  };
  /**
   * @deprecated Persisté pour rétrocompatibilité ; non branché au moteur PV (voir backend `orgSettingsDeprecated.js`).
   */
  pvtech?: {
    system_yield_pct?: number;
    panel_surface_m2?: number;
    fallback_prod_kwh_kwc?: number;
    longi_eff_pct?: number;
    longi_lowlight_gain_pct?: number;
    longi_temp_coeff_pct?: number;
    longi_deg1_pct?: number;
    longi_deg2_pct?: number;
    standard_loss_pct?: number;
    micro_eff_pct?: number;
    micro_mppt_pct?: number;
  };
  components?: {
    module_label?: string;
    micro_label?: string;
    coffret_label?: string;
    conformity_text?: string;
    battery_warranty_years?: number;
    micro_eff_pct?: number;
    micro_mppt_pct?: number;
    micro_ac_w?: number;
    micro_dc_w?: number;
    standard_loss_pct?: number;
  };
  /**
   * @deprecated Persisté pour rétrocompatibilité ; non branché au moteur (voir backend `orgSettingsDeprecated.js`).
   */
  ai?: {
    use_enedis_first?: boolean;
    use_pvgis?: boolean;
    use_ai_fallback?: boolean;
  };
  calpinage_rules?: {
    distanceLimitesCm?: number;
    espacementHorizontalCm?: number;
    espacementVerticalCm?: number;
    orientationDefault?: "portrait" | "paysage";
  };
  /** Grilles tarifaires batterie virtuelle par fournisseur (tarifs 2026). */
  pv?: {
    virtual_battery?: import("../types/pvVirtualBatterySettings").PvVirtualBatterySettings;
  };
  /** storage_key du logo (entity_documents) */
  logo_image_key?: string | null;
  /** storage_key de l'image couverture PDF (entity_documents) */
  pdf_cover_image_key?: string | null;
  /** Préfixe unique numérotation devis / factures / avoirs (settings_json.documents) */
  documents?: {
    document_prefix?: string | null;
  };
}

export async function adminGetOrgSettings(): Promise<OrgPvSettings> {
  const res = await apiFetch(apiUrl(`${BASE}/org/settings`));
  return handleResponse<OrgPvSettings>(res);
}

export async function adminPostOrgSettings(body: Partial<OrgPvSettings>): Promise<OrgPvSettings> {
  const res = await apiFetch(apiUrl(`${BASE}/org/settings`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<OrgPvSettings>(res);
}

// --- Archives (CP-AUTO-CONVERT-ARCHIVE-08) ---
export interface AdminArchiveItem {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  archived_at: string;
  archived_by: string | null;
  archived_by_email: string | null;
  archived_reason: string | null;
  stage_name: string | null;
}

export async function adminGetArchives(): Promise<{ items: AdminArchiveItem[] }> {
  const res = await apiFetch(apiUrl(`${BASE}/archives`));
  return handleResponse<{ items: AdminArchiveItem[] }>(res);
}

export async function adminRestoreArchive(id: string): Promise<unknown> {
  const res = await apiFetch(apiUrl(`${BASE}/archives/${id}/restore`), {
    method: "POST",
  });
  return handleResponse<unknown>(res);
}

/**
 * CP-ARCHIVE-EXPORT-09 — Export CSV des archives
 * Télécharge le fichier archives-export.csv
 */
export async function adminExportArchivesCsv(): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/archives/export`));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "archives-export.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function orgGetSettings(): Promise<Record<string, unknown>> {
  const res = await apiFetch(apiUrl("/api/organization/settings"));
  return handleResponse<Record<string, unknown>>(res);
}

export async function orgPutSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await apiFetch(apiUrl("/api/organization/settings"), {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return handleResponse<Record<string, unknown>>(res);
}

// --- CP-001 Paramètres économiques SmartPitch (GET/PUT /api/organizations/settings) ---
export interface SmartpitchEconomics {
  price_eur_kwh: number;
  elec_growth_pct: number;
  oa_rate_lt_9: number;
  oa_rate_gte_9: number;
  prime_lt9: number;
  prime_gte9: number;
  pv_degradation_pct: number;
  horizon_years: number;
  maintenance_pct: number;
  onduleur_year: number;
  onduleur_cost_pct: number;
  battery_degradation_pct?: number;
}

export interface SmartpitchSettingsResponse {
  economics: SmartpitchEconomics;
}

/** CP-080 — réponse étendue (economics + quote + finance) */
export interface OrgQuoteSettings {
  prefix: string;
  next_number: number;
}

export interface OrgFinanceSettings {
  default_vat_rate: number;
}

export interface OrganizationsFullSettingsResponse extends SmartpitchSettingsResponse {
  quote: OrgQuoteSettings;
  finance: OrgFinanceSettings;
  settings_json?: Record<string, unknown>;
}

export async function getOrganizationsSettings(): Promise<OrganizationsFullSettingsResponse> {
  const res = await apiFetch(apiUrl("/api/organizations/settings"));
  return handleResponse<OrganizationsFullSettingsResponse>(res);
}

export async function putOrganizationsSettings(body: {
  economics?: Partial<SmartpitchEconomics>;
  quote?: { prefix?: string | null; next_number?: number };
  finance?: Partial<OrgFinanceSettings>;
}): Promise<OrganizationsFullSettingsResponse> {
  const res = await apiFetch(apiUrl("/api/organizations/settings"), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<OrganizationsFullSettingsResponse>(res);
}

// --- CP-QUOTE-002 Catalogue devis ---
/** Doit rester aligné avec `QUOTE_CATALOG_DESCRIPTION_MAX_CHARS` côté backend (admin.quoteCatalog.controller.js). */
export const QUOTE_CATALOG_DESCRIPTION_MAX_CHARS = 8000;

export type QuoteCatalogCategory =
  | "PANEL"
  | "INVERTER"
  | "MOUNTING"
  | "CABLE"
  | "PROTECTION_BOX"
  | "INSTALL"
  | "SERVICE"
  | "BATTERY_PHYSICAL"
  | "BATTERY_VIRTUAL"
  | "PACK"
  | "DISCOUNT"
  | "OTHER";

export type QuoteCatalogPricingMode = "FIXED" | "UNIT" | "PERCENT_TOTAL";

export interface QuoteCatalogItem {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  category: QuoteCatalogCategory;
  pricing_mode: QuoteCatalogPricingMode;
  sale_price_ht_cents: number;
  purchase_price_ht_cents: number;
  default_vat_rate_bps: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function adminGetQuoteCatalog(params?: {
  include_inactive?: boolean;
  q?: string;
  category?: string;
}): Promise<{ items: QuoteCatalogItem[] }> {
  const sp = new URLSearchParams();
  if (params?.include_inactive) sp.set("include_inactive", "true");
  if (params?.q) sp.set("q", params.q);
  if (params?.category) sp.set("category", params.category);
  const qs = sp.toString();
  const res = await apiFetch(apiUrl(`${BASE}/quote-catalog${qs ? `?${qs}` : ""}`));
  return handleResponse<{ items: QuoteCatalogItem[] }>(res);
}

export async function adminCreateQuoteCatalogItem(body: {
  name: string;
  description?: string | null;
  category: QuoteCatalogCategory;
  pricing_mode?: QuoteCatalogPricingMode;
  sale_price_ht_cents?: number;
  purchase_price_ht_cents?: number;
  default_vat_rate_bps?: number;
}): Promise<{ item: QuoteCatalogItem }> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-catalog`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<{ item: QuoteCatalogItem }>(res);
}

export async function adminPatchQuoteCatalogItem(
  id: string,
  body: Partial<{
    name: string;
    description: string | null;
    category: QuoteCatalogCategory;
    pricing_mode: QuoteCatalogPricingMode;
    sale_price_ht_cents: number;
    purchase_price_ht_cents: number;
    default_vat_rate_bps: number;
  }>
): Promise<{ item: QuoteCatalogItem }> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-catalog/${id}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return handleResponse<{ item: QuoteCatalogItem }>(res);
}

export async function adminDeactivateQuoteCatalogItem(id: string): Promise<{ item: QuoteCatalogItem }> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-catalog/${id}/deactivate`), { method: "POST" });
  return handleResponse<{ item: QuoteCatalogItem }>(res);
}

export async function adminActivateQuoteCatalogItem(id: string): Promise<{ item: QuoteCatalogItem }> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-catalog/${id}/activate`), { method: "POST" });
  return handleResponse<{ item: QuoteCatalogItem }>(res);
}

// --- Modèles de texte devis (notes / technique / paiement) ---
export type QuoteTextTemplateKind = "commercial_notes" | "technical_details" | "payment_terms";

export interface QuoteTextTemplateItem {
  id: string;
  organization_id: string;
  template_kind: QuoteTextTemplateKind;
  name: string;
  content: string;
  created_at: string;
}

export async function adminGetQuoteTextTemplates(params?: {
  kind?: QuoteTextTemplateKind;
}): Promise<{ items: QuoteTextTemplateItem[] }> {
  const sp = new URLSearchParams();
  if (params?.kind) sp.set("kind", params.kind);
  const qs = sp.toString();
  const res = await apiFetch(apiUrl(`${BASE}/quote-text-templates${qs ? `?${qs}` : ""}`));
  return handleResponse<{ items: QuoteTextTemplateItem[] }>(res);
}

export async function adminCreateQuoteTextTemplate(body: {
  template_kind: QuoteTextTemplateKind;
  name: string;
  content: string;
}): Promise<{ item: QuoteTextTemplateItem }> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-text-templates`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<{ item: QuoteTextTemplateItem }>(res);
}

export async function adminPatchQuoteTextTemplate(
  id: string,
  body: Partial<{ name: string; content: string }>
): Promise<{ item: QuoteTextTemplateItem }> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-text-templates/${id}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return handleResponse<{ item: QuoteTextTemplateItem }>(res);
}

export async function adminDeleteQuoteTextTemplate(id: string): Promise<void> {
  const res = await apiFetch(apiUrl(`${BASE}/quote-text-templates/${id}`), { method: "DELETE" });
  await handleResponse<{ ok?: boolean }>(res);
}
