/**
 * API Batteries virtuelles (Paramètres PV) — CRUD admin
 */

import { apiFetch } from "../services/api";

const BASE = "/api/admin/pv/virtual-batteries";

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as T;
}

export type PricingModel = "per_kwc" | "per_capacity" | "per_kwc_with_variable" | "custom";

export interface CapacityTableRow {
  capacity_kwh: number;
  monthly_subscription_ht: number;
}

export interface PvVirtualBattery {
  id: string;
  organization_id: string;
  name: string;
  provider_code: string;
  pricing_model: PricingModel;
  monthly_subscription_ht: number | null;
  cost_per_kwh_ht: number | null;
  activation_fee_ht: number | null;
  contribution_autoproducteur_ht: number | null;
  includes_network_fees: boolean;
  indexed_on_trv: boolean;
  capacity_table: CapacityTableRow[] | null;
  tariff_grid_json?: Record<string, unknown> | null;
  tariff_source_label?: string | null;
  tariff_effective_date?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function listVirtualBatteries(): Promise<PvVirtualBattery[]> {
  const res = await apiFetch(BASE);
  return handleResponse<PvVirtualBattery[]>(res);
}

export async function createVirtualBattery(
  body: Partial<PvVirtualBattery>
): Promise<PvVirtualBattery> {
  const res = await apiFetch(BASE, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<PvVirtualBattery>(res);
}

export async function updateVirtualBattery(
  id: string,
  body: Partial<PvVirtualBattery>
): Promise<PvVirtualBattery> {
  const res = await apiFetch(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<PvVirtualBattery>(res);
}

export async function deleteVirtualBattery(id: string): Promise<void> {
  const res = await apiFetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
}
