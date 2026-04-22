/**
 * Service Adresse — autocomplete, CRUD, verify-pin
 * CP-028 / Architecture Adresse V1
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

export interface AutocompleteSuggestion {
  place_id: string;
  label: string;
  provider?: string;
  precision_level?: string;
  confidence?: number;
  lat: number | null;
  lon: number | null;
  components: {
    address_line1?: string | null;
    address_line2?: string | null;
    postal_code?: string | null;
    city?: string | null;
    country_code?: string;
  };
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
}

export async function geoAutocomplete(
  q: string,
  options?: { limit?: number; country?: string }
): Promise<AutocompleteResponse> {
  const params = new URLSearchParams();
  params.set("q", q.trim());
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.country) params.set("country", options.country);
  const res = await apiFetch(`${API_BASE}/api/geo/autocomplete?${params.toString()}`);
  if (!res.ok) throw new Error("Erreur autocomplete");
  return res.json();
}

export interface AddressPayload {
  label?: string;
  address_line1?: string;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string;
  formatted_address?: string;
  lat?: number | null;
  lon?: number | null;
  geo_provider?: string;
  geo_place_id?: string;
  geo_source?: string;
  geo_precision_level?: string | null;
  geo_confidence?: number | null;
  geo_bbox?: unknown;
}

export async function createAddress(payload: AddressPayload): Promise<{ id: string }> {
  const res = await apiFetch(`${API_BASE}/api/addresses`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Erreur création adresse");
  }
  return res.json();
}

export async function patchAddress(
  id: string,
  payload: Partial<AddressPayload>
): Promise<unknown> {
  const res = await apiFetch(`${API_BASE}/api/addresses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Erreur mise à jour adresse");
  }
  return res.json();
}

export interface CadastreByPointResult {
  section: string;
  numero: string;
  parcelle: string;
  surface_m2: number | null;
  commune?: string;
}

export async function fetchCadastreByPoint(
  lat: number,
  lon: number
): Promise<CadastreByPointResult | null> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await apiFetch(`${API_BASE}/api/cadastre/by-point?${params.toString()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Erreur récupération parcelle cadastrale");
  return res.json();
}

export async function verifyPin(
  addressId: string,
  lat: number,
  lon: number,
  geoNotes?: string
): Promise<{
  id: string;
  lat: number;
  lon: number;
  geo_precision_level: string;
  is_geo_verified: boolean;
  geo_verification_method?: string;
  geo_updated_at?: string;
}> {
  const res = await apiFetch(`${API_BASE}/api/addresses/verify-pin`, {
    method: "POST",
    body: JSON.stringify({ address_id: addressId, lat, lon, geo_notes: geoNotes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Erreur vérification pin");
  }
  return res.json();
}
