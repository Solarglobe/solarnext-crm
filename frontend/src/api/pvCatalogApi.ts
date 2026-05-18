/**
 * CP-002 — API catalogue PV (panneaux, onduleurs, batteries)
 */

import { buildApiUrl } from "@/config/crmApiBase";
import { apiFetch } from "../services/api";

const BASE = "/api/pv";
const u = (path: string) => buildApiUrl(path);

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as T;
}

// --- Panneaux ---
export interface PvPanel {
  id: string;
  name: string;
  brand: string;
  model_ref: string;
  technology?: string;
  bifacial: boolean;
  power_wc: number;
  efficiency_pct: number;
  temp_coeff_pct_per_deg?: number;
  degradation_first_year_pct: number;
  degradation_annual_pct: number;
  voc_v?: number;
  isc_a?: number;
  vmp_v?: number;
  imp_a?: number;
  width_mm: number;
  height_mm: number;
  thickness_mm?: number;
  weight_kg?: number;
  warranty_product_years?: number;
  warranty_performance_years?: number;
  certificate_iec?: string | null;
  shading_compatible?: boolean;
  area_m2?: number | null;
  source_name?: string | null;
  source_url?: string | null;
  datasheet_url?: string | null;
  image_url?: string | null;
  last_verified_at?: string | null;
  data_confidence?: number | null;
  status?: "active" | "out_of_stock" | "discontinued";
  is_favorite?: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function listPanels(): Promise<PvPanel[]> {
  const res = await apiFetch(u(`${BASE}/panels`));
  return handleResponse<PvPanel[]>(res);
}

export async function createPanel(body: Partial<PvPanel>): Promise<PvPanel> {
  const res = await apiFetch(u(`${BASE}/panels`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<PvPanel>(res);
}

export async function updatePanel(id: string, body: Partial<PvPanel>): Promise<PvPanel> {
  const res = await apiFetch(u(`${BASE}/panels/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<PvPanel>(res);
}

export async function togglePanelActive(panel: PvPanel): Promise<PvPanel> {
  return updatePanel(panel.id, { active: !panel.active });
}

export async function importPanels(rows: Partial<PvPanel>[]): Promise<{ results: Array<{ status: number; row: unknown }> }> {
  const res = await apiFetch(u(`${BASE}/panels/import`), {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  return handleResponse(res);
}

// --- Onduleurs ---
export interface PvInverter {
  id: string;
  name: string;
  brand: string;
  model_ref: string;
  inverter_type: "micro" | "string";
  inverter_family?: "CENTRAL" | "MICRO";
  nominal_power_kw?: number;
  nominal_va?: number;
  phases?: string;
  mppt_count?: number;
  inputs_per_mppt?: number;
  modules_per_inverter?: number | null;
  mppt_min_v?: number;
  mppt_max_v?: number;
  max_input_current_a?: number;
  max_dc_power_kw?: number;
  euro_efficiency_pct?: number;
  compatible_battery: boolean;
  monitoring_integrated?: boolean;
  source_name?: string | null;
  source_url?: string | null;
  datasheet_url?: string | null;
  image_url?: string | null;
  last_verified_at?: string | null;
  data_confidence?: number | null;
  status?: "active" | "out_of_stock" | "discontinued";
  is_favorite?: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function listInverters(family?: "CENTRAL" | "MICRO"): Promise<PvInverter[]> {
  const url = family ? `${BASE}/inverters?family=${family}` : `${BASE}/inverters`;
  const res = await apiFetch(u(url));
  return handleResponse<PvInverter[]>(res);
}

export async function createInverter(body: Partial<PvInverter>): Promise<PvInverter> {
  const res = await apiFetch(u(`${BASE}/inverters`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<PvInverter>(res);
}

export async function updateInverter(id: string, body: Partial<PvInverter>): Promise<PvInverter> {
  const res = await apiFetch(u(`${BASE}/inverters/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<PvInverter>(res);
}

export async function toggleInverterActive(inv: PvInverter): Promise<PvInverter> {
  return updateInverter(inv.id, { active: !inv.active });
}

export async function importInverters(rows: Partial<PvInverter>[]): Promise<{ results: Array<{ status: number; row: unknown }> }> {
  const res = await apiFetch(u(`${BASE}/inverters/import`), {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  return handleResponse(res);
}

// --- Batteries ---
export interface PvBattery {
  id: string;
  name: string;
  brand: string;
  model_ref: string;
  usable_kwh: number;
  nominal_voltage_v?: number;
  max_charge_kw?: number;
  max_discharge_kw?: number;
  roundtrip_efficiency_pct?: number;
  depth_of_discharge_pct?: number;
  cycle_life?: number;
  chemistry?: string;
  scalable: boolean;
  max_modules?: number;
  /** Puissance de charge maximale du système, indépendante de qty. null = pur parallèle (qty × unit). */
  max_system_charge_kw?: number | null;
  /** Puissance de décharge maximale du système, indépendante de qty. null = pur parallèle. */
  max_system_discharge_kw?: number | null;
  warranty_years?: number | null;
  source_name?: string | null;
  source_url?: string | null;
  datasheet_url?: string | null;
  image_url?: string | null;
  last_verified_at?: string | null;
  data_confidence?: number | null;
  status?: "active" | "out_of_stock" | "discontinued";
  is_favorite?: boolean;
  active: boolean;
  default_price_ht?: number | null;
  /** Coût d'achat unitaire HT (marge interne) — optionnel */
  purchase_price_ht?: number | null;
  created_at?: string;
  updated_at?: string;
}

export async function listBatteries(): Promise<PvBattery[]> {
  const res = await apiFetch(u(`${BASE}/batteries`));
  return handleResponse<PvBattery[]>(res);
}

export async function createBattery(body: Partial<PvBattery>): Promise<PvBattery> {
  const res = await apiFetch(u(`${BASE}/batteries`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<PvBattery>(res);
}

export async function updateBattery(id: string, body: Partial<PvBattery>): Promise<PvBattery> {
  const res = await apiFetch(u(`${BASE}/batteries/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<PvBattery>(res);
}

export async function toggleBatteryActive(bat: PvBattery): Promise<PvBattery> {
  return updateBattery(bat.id, { active: !bat.active });
}

export async function importBatteries(rows: Partial<PvBattery>[]): Promise<{ results: Array<{ status: number; row: unknown }> }> {
  const res = await apiFetch(u(`${BASE}/batteries/import`), {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  return handleResponse(res);
}

// --- Fixations ---
export interface PvMountingSystem {
  id: string;
  name: string;
  brand: string;
  model_ref: string;
  mounting_type: "surimposition" | "integration" | "sol" | string;
  roof_compatibility: string[];
  material?: string | null;
  max_panel_width_mm?: number | null;
  max_panel_height_mm?: number | null;
  certificate_iec?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  datasheet_url?: string | null;
  image_url?: string | null;
  last_verified_at?: string | null;
  data_confidence?: number | null;
  status?: "active" | "out_of_stock" | "discontinued";
  is_favorite?: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export async function listMountingSystems(): Promise<PvMountingSystem[]> {
  const res = await apiFetch(u(`${BASE}/mounting-systems`));
  return handleResponse<PvMountingSystem[]>(res);
}

export async function createMountingSystem(body: Partial<PvMountingSystem>): Promise<PvMountingSystem> {
  const res = await apiFetch(u(`${BASE}/mounting-systems`), {
    method: "POST",
    body: JSON.stringify(body),
  });
  return handleResponse<PvMountingSystem>(res);
}

export async function updateMountingSystem(id: string, body: Partial<PvMountingSystem>): Promise<PvMountingSystem> {
  const res = await apiFetch(u(`${BASE}/mounting-systems/${id}`), {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return handleResponse<PvMountingSystem>(res);
}

export async function toggleMountingSystemActive(row: PvMountingSystem): Promise<PvMountingSystem> {
  return updateMountingSystem(row.id, { active: !row.active });
}

export async function importMountingSystems(rows: Partial<PvMountingSystem>[]): Promise<{ results: Array<{ status: number; row: unknown }> }> {
  const res = await apiFetch(u(`${BASE}/mounting-systems/import`), {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  return handleResponse(res);
}
