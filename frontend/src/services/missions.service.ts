/**
 * Mission Engine V1 — Service API missions
 */

import { apiFetch } from "./api";

const API_BASE = import.meta.env?.VITE_API_URL || "http://localhost:3000";

export interface MissionType {
  id: string;
  name: string;
  color?: string;
  default_duration_minutes?: number;
}

export interface MissionAssignment {
  user_id: string;
  team_id?: string;
}

export interface Mission {
  id: string;
  organization_id: string;
  title: string;
  description?: string;
  mission_type_id?: string;
  mission_type_name?: string;
  mission_type_color?: string;
  start_at: string;
  end_at: string;
  status: string;
  client_id?: string;
  project_id?: string;
  agency_id?: string;
  is_private_block: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignments?: MissionAssignment[];
  /** Enrichi par le backend (JOIN clients) */
  client_number?: string;
  client_first_name?: string;
  client_last_name?: string;
  client_company_name?: string;
  /** Enrichi par le backend (JOIN studies) */
  study_number?: string;
  study_title?: string;
}

export interface MissionsFilters {
  user_id?: string;
  team_id?: string;
  agency_id?: string;
  mission_type_id?: string;
  from?: string;
  to?: string;
}

export async function fetchMissionTypes(): Promise<MissionType[]> {
  const res = await apiFetch(`${API_BASE}/api/missions/types`);
  if (!res.ok) throw new Error("Erreur chargement types de mission");
  return res.json();
}

export async function fetchMissions(filters: MissionsFilters = {}): Promise<Mission[]> {
  const params = new URLSearchParams();
  if (filters.user_id) params.set("user_id", filters.user_id);
  if (filters.team_id) params.set("team_id", filters.team_id);
  if (filters.agency_id) params.set("agency_id", filters.agency_id);
  if (filters.mission_type_id) params.set("mission_type_id", filters.mission_type_id);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  const qs = params.toString();
  const url = qs ? `${API_BASE}/api/missions?${qs}` : `${API_BASE}/api/missions`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error("Erreur chargement missions");
  return res.json();
}

export async function fetchMissionById(id: string): Promise<Mission> {
  const res = await apiFetch(`${API_BASE}/api/missions/${id}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Mission non trouvée");
    throw new Error("Erreur chargement mission");
  }
  return res.json();
}

export interface CreateMissionPayload {
  title: string;
  description?: string;
  mission_type_id?: string;
  start_at: string;
  end_at: string;
  status?: string;
  client_id?: string;
  project_id?: string;
  agency_id?: string;
  is_private_block?: boolean;
  assignments?: { user_id: string; team_id?: string }[];
}

export async function createMission(payload: CreateMissionPayload): Promise<Mission> {
  const res = await apiFetch(`${API_BASE}/api/missions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) throw new Error(err.error || "Conflit horaire");
    throw new Error(err.error || "Erreur création mission");
  }
  return res.json();
}

export async function updateMissionTime(
  id: string,
  startAt: string,
  endAt: string
): Promise<Mission> {
  const res = await apiFetch(`${API_BASE}/api/missions/${id}/time`, {
    method: "PATCH",
    body: JSON.stringify({ start_at: startAt, end_at: endAt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) throw new Error(err.error || "Conflit horaire");
    throw new Error(err.error || "Erreur mise à jour");
  }
  return res.json();
}

export interface UpdateMissionPayload {
  title?: string;
  description?: string;
  mission_type_id?: string;
  start_at?: string;
  end_at?: string;
  status?: string;
  client_id?: string;
  project_id?: string;
  agency_id?: string;
  is_private_block?: boolean;
  assignments?: { user_id: string; team_id?: string }[];
}

export async function updateMission(
  id: string,
  payload: UpdateMissionPayload
): Promise<Mission> {
  const res = await apiFetch(`${API_BASE}/api/missions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) throw new Error(err.error || "Conflit horaire");
    if (res.status === 403) throw new Error(err.error || "Permission refusée");
    throw new Error(err.error || "Erreur mise à jour");
  }
  return res.json();
}

export async function deleteMission(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/missions/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 403) throw new Error(err.error || "Permission refusée");
    throw new Error(err.error || "Erreur suppression");
  }
}

export async function fetchMissionsByClientId(clientId: string): Promise<Mission[]> {
  const res = await apiFetch(`${API_BASE}/api/clients/${clientId}/missions`);
  if (!res.ok) throw new Error("Erreur chargement missions client");
  return res.json();
}

export async function createMissionFromClient(
  clientId: string,
  payload: Omit<CreateMissionPayload, "client_id">
): Promise<Mission> {
  const res = await apiFetch(`${API_BASE}/api/clients/${clientId}/missions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409) throw new Error(err.error || "Conflit horaire");
    throw new Error(err.error || "Erreur création mission");
  }
  return res.json();
}
