/**
 * Service API clients (pour MissionCreateModal)
 */

import { apiFetch } from "./api";

const API_BASE = import.meta.env?.VITE_API_URL || "http://localhost:3000";

export interface Client {
  id: string;
  client_number?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  email?: string;
}

export async function fetchClients(): Promise<Client[]> {
  const res = await apiFetch(`${API_BASE}/api/clients`);
  if (!res.ok) throw new Error("Erreur chargement clients");
  return res.json();
}
