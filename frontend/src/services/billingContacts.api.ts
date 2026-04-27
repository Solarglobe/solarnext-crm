/**
 * Listes strictes Client / Lead pour la facturation (aucune liste CRM générique).
 */
import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

/** Champs optionnels pour recherche locale (facturation). */
export type BillingSelectRow = {
  id: string;
  full_name: string;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

export type BillingSelectClientRow = BillingSelectRow & { type: "CLIENT" };
export type BillingSelectLeadRow = BillingSelectRow & { type: "LEAD" };

export type BillingContactsSelectResponse = {
  clients: BillingSelectClientRow[];
  leads: BillingSelectLeadRow[];
};

/** GET /api/clients/select — table clients uniquement. */
export async function fetchClientsBillingSelect(): Promise<BillingSelectRow[]> {
  const res = await apiFetch(`${API_BASE}/api/clients/select`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status} chargement clients (facturation)`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Réponse clients/select invalide");
  return data as BillingSelectRow[];
}

/** GET /api/leads/select — table leads uniquement. */
export async function fetchLeadsBillingSelect(): Promise<BillingSelectRow[]> {
  const res = await apiFetch(`${API_BASE}/api/leads/select`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status} chargement leads (facturation)`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Réponse leads/select invalide");
  return data as BillingSelectRow[];
}

/** GET /api/contacts/select — agrégat typé (outils / intégrations). */
export async function fetchContactsBillingSelect(): Promise<BillingContactsSelectResponse> {
  const res = await apiFetch(`${API_BASE}/api/contacts/select`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status} chargement contacts (facturation)`);
  }
  const data = (await res.json()) as BillingContactsSelectResponse;
  if (!data || typeof data !== "object") throw new Error("Réponse contacts/select invalide");
  return {
    clients: Array.isArray(data.clients) ? data.clients : [],
    leads: Array.isArray(data.leads) ? data.leads : [],
  };
}
