/**
 * Service API clients (pour MissionCreateModal)
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

export interface Client {
  id: string;
  client_number?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  email?: string;
  phone?: string | null;
  mobile?: string | null;
  /** ISO date — aligné fiche lead / mandat DP */
  birth_date?: string | null;
  rgpd_consent?: boolean;
  rgpd_consent_at?: string | null;
  marketing_opt_in?: boolean;
  marketing_opt_in_at?: string | null;
}

export interface ClientsListFilters {
  created_from?: string;
  created_to?: string;
  marketing_opt_in?: boolean;
}

export async function fetchClients(filters?: ClientsListFilters): Promise<Client[]> {
  const params = new URLSearchParams();
  if (filters?.created_from) params.set("created_from", filters.created_from);
  if (filters?.created_to) params.set("created_to", filters.created_to);
  if (filters?.marketing_opt_in !== undefined) {
    params.set("marketing_opt_in", String(filters.marketing_opt_in));
  }
  const qs = params.toString();
  const url = `${API_BASE}/api/clients${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error("Erreur chargement clients");
  return res.json();
}

export async function fetchClientById(id: string): Promise<Client> {
  const res = await apiFetch(`${API_BASE}/api/clients/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Erreur chargement client");
  return res.json();
}

export async function patchClient(id: string, body: Partial<Client>): Promise<Client> {
  const res = await apiFetch(`${API_BASE}/api/clients/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Erreur mise à jour client");
  }
  return res.json();
}
