import { apiFetch } from "./api";
import { getCrmApiBase } from "../config/crmApiBase";

/** Ligne liste SUPER_ADMIN (GET /api/organizations) ; sinon id + name seulement. */
export type OrganizationListRow = {
  id: string;
  name: string;
  created_at?: string | null;
  leads_count?: number;
  clients_count?: number;
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
