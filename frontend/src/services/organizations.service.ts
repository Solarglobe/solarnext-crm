import {
  apiFetch,
  AUTH_TOKEN_PRE_IMPERSONATION_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  IMPERSONATION_BANNER_KEY,
  IMPERSONATION_META_KEY,
} from "./api";
import { adminImpersonateUser } from "./admin.api";
import { decodeJwtPayloadUnsafe } from "./auth.service";
import { getCrmApiBase } from "../config/crmApiBase";

const LS_ORG = "solarnext_current_organization_id";

/**
 * Si le jeton courant est une impersonation expirée, purge le stockage client.
 * @returns true si une impersonation expirée a été détectée (rediriger vers `/admin/organizations`).
 */
export function wasImpersonationTokenExpiredAndCleared(): boolean {
  if (typeof window === "undefined") return false;
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (!token) return false;
  const p = decodeJwtPayloadUnsafe(token);
  if (!p?.impersonation) return false;
  if (typeof p.exp !== "number") return false;
  const now = Math.floor(Date.now() / 1000);
  if (p.exp > now - 30) return false;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY);
  localStorage.removeItem(IMPERSONATION_META_KEY);
  localStorage.removeItem(IMPERSONATION_BANNER_KEY);
  localStorage.removeItem(LS_ORG);
  localStorage.removeItem("solarnext_super_admin");
  localStorage.removeItem("solarnext_super_admin_edit_mode");
  return true;
}

/** Ligne liste SUPER_ADMIN (GET /api/organizations ou /api/admin/organizations) ; sinon id + name seulement. */
export type OrganizationListRow = {
  id: string;
  name: string;
  /** Slug normalisé pour la recherche (côté API) */
  slug?: string;
  created_at?: string | null;
  leads_count?: number;
  clients_count?: number;
  is_archived?: boolean;
  archived_at?: string | null;
};

export type OrganizationOption = OrganizationListRow;

export async function fetchOrganizations(): Promise<OrganizationListRow[]> {
  const API_BASE = getCrmApiBase();
  const res = await apiFetch(`${API_BASE}/api/organizations`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Impossible de charger les organisations");
  }
  return res.json() as Promise<OrganizationListRow[]>;
}

/**
 * SUPER_ADMIN — liste admin (hors orgs archivées par défaut).
 */
export async function fetchAdminOrganizations(
  options: { includeArchived?: boolean } = {}
): Promise<OrganizationListRow[]> {
  const API_BASE = getCrmApiBase();
  const q = options.includeArchived ? "?includeArchived=true" : "";
  const res = await apiFetch(`${API_BASE}/api/admin/organizations${q}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Impossible de charger les organisations");
  }
  return res.json() as Promise<OrganizationListRow[]>;
}

function parseErrorJson(t: string): { error?: string } {
  try {
    return JSON.parse(t) as { error?: string };
  } catch {
    return {};
  }
}

export async function adminArchiveOrganization(id: string): Promise<void> {
  const API_BASE = getCrmApiBase();
  const res = await apiFetch(`${API_BASE}/api/admin/organizations/${id}/archive`, {
    method: "PATCH",
  });
  if (!res.ok) {
    const t = await res.text();
    const j = parseErrorJson(t);
    throw new Error(j.error || t || "Archivage impossible");
  }
}

export async function adminRestoreOrganization(id: string): Promise<void> {
  const API_BASE = getCrmApiBase();
  const res = await apiFetch(`${API_BASE}/api/admin/organizations/${id}/restore`, {
    method: "PATCH",
  });
  if (!res.ok) {
    const t = await res.text();
    const j = parseErrorJson(t);
    throw new Error(j.error || t || "Restauration impossible");
  }
}

export async function adminDeleteOrganization(id: string): Promise<void> {
  const API_BASE = getCrmApiBase();
  const res = await apiFetch(`${API_BASE}/api/admin/organizations/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const t = await res.text();
    const j = parseErrorJson(t);
    throw new Error(j.error || t || "Suppression impossible");
  }
}

export type AdminImpersonateResponse = {
  token: string;
  expiresInSec: number;
  organization: { id: string; name: string };
};

/**
 * Super admin : obtient un jeton court d’impersonation pour l’organisation cible, puis le stocke.
 * Sauvegarde le jeton courant pour « Quitter ».
 */
export async function adminImpersonateAndEnterSession(organizationId: string): Promise<AdminImpersonateResponse> {
  const API_BASE = getCrmApiBase();
  const current = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (current) {
    localStorage.setItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY, current);
  }
  const res = await apiFetch(`${API_BASE}/api/admin/organizations/${organizationId}/impersonate`, {
    method: "POST",
  });
  if (!res.ok) {
    localStorage.removeItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY);
    const t = await res.text();
    const j = parseErrorJson(t);
    throw new Error(j.error || t || "Impersonation impossible");
  }
  const data = (await res.json()) as AdminImpersonateResponse;
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
  const meta = {
    type: "ORG" as const,
    organizationName: data.organization.name,
    organizationId: data.organization.id,
  };
  localStorage.setItem(IMPERSONATION_META_KEY, JSON.stringify(meta));
  localStorage.removeItem(IMPERSONATION_BANNER_KEY);
  localStorage.setItem("solarnext_current_organization_id", data.organization.id);
  localStorage.setItem("solarnext_super_admin", "0");
  localStorage.setItem("solarnext_super_admin_edit_mode", "0");
  return data;
}

/**
 * Super admin : impersonation d’un utilisateur (permissions réelles, pas de bypass).
 */
export async function adminUserImpersonateAndEnterSession(
  userId: string,
  labels: { userName: string; organizationName: string }
): Promise<void> {
  const current = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  if (current) {
    localStorage.setItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY, current);
  }
  try {
    const data = await adminImpersonateUser(userId);
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
    localStorage.setItem(
      IMPERSONATION_META_KEY,
      JSON.stringify({
        type: "USER" as const,
        userName: data.user.name || labels.userName,
        organizationName: data.user.organizationName || labels.organizationName,
        userId: data.user.id,
        organizationId: data.user.organizationId,
      })
    );
    localStorage.removeItem(IMPERSONATION_BANNER_KEY);
    localStorage.setItem("solarnext_current_organization_id", data.user.organizationId);
    localStorage.setItem("solarnext_super_admin", "0");
    localStorage.setItem("solarnext_super_admin_edit_mode", "0");
  } catch (e) {
    localStorage.removeItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY);
    throw e;
  }
}

/** Retour super-admin : restaure le jeton d’origine (après impersonation). */
export function exitAdminImpersonationSession(): void {
  const prev = localStorage.getItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY);
  if (prev) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, prev);
    const p = decodeJwtPayloadUnsafe(prev);
    if (p?.organizationId) {
      localStorage.setItem(LS_ORG, p.organizationId);
    } else {
      localStorage.removeItem(LS_ORG);
    }
  }
  localStorage.removeItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY);
  localStorage.removeItem(IMPERSONATION_BANNER_KEY);
  localStorage.removeItem(IMPERSONATION_META_KEY);
  window.location.href = "/admin/organizations";
}

/**
 * Audit entrée / sortie mode support (SUPER_ADMIN).
 * @param organizationId cible, ou `null` pour revenir au compte JWT (principal).
 */
export async function postSuperAdminOrgSwitchAudit(organizationId: string | null): Promise<void> {
  const API_BASE = getCrmApiBase();
  const res = await apiFetch(`${API_BASE}/api/organizations/super-admin/org-switch-audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization_id: organizationId }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Audit impossible");
  }
}
