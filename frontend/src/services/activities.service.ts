/**
 * CP-030 — Service Activités CRM
 */

import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

export type ActivityType =
  | "NOTE"
  | "CALL"
  | "MEETING"
  | "EMAIL"
  | "STATUS_CHANGE"
  | "STAGE_CHANGE"
  | "ADDRESS_VERIFIED"
  | "PROJECT_STATUS_CHANGE"
  | "DEVIS_SIGNE"
  | "INSTALLATION_TERMINEE";

export interface ActivityCreatedBy {
  id: string;
  name: string;
  email: string | null;
}

export interface Activity {
  id: string;
  type: ActivityType;
  title: string | null;
  content: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
  created_by: ActivityCreatedBy;
  is_pinned: boolean;
}

export interface ActivitiesFilters {
  type?: ActivityType | ActivityType[];
  from?: string;
  to?: string;
  author?: string;
  limit?: number;
  page?: number;
}

export interface CreateActivityPayload {
  type: "NOTE" | "CALL" | "MEETING" | "EMAIL";
  title?: string;
  content?: string;
  occurred_at?: string;
  payload?: Record<string, unknown>;
}

export interface UpdateActivityPayload {
  title?: string;
  content?: string;
  occurred_at?: string;
  is_pinned?: boolean;
}

export async function fetchActivities(
  leadId: string,
  filters?: ActivitiesFilters
): Promise<{ items: Activity[] }> {
  const params = new URLSearchParams();
  if (filters?.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    types.forEach((t) => params.append("type", t));
  }
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  if (filters?.author) params.set("author", filters.author);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.page) params.set("page", String(filters.page));

  const qs = params.toString();
  const url = `${API_BASE}/api/leads/${leadId}/activities${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function createActivity(
  leadId: string,
  data: CreateActivityPayload
): Promise<Activity> {
  const res = await apiFetch(`${API_BASE}/api/leads/${leadId}/activities`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function updateActivity(
  activityId: string,
  patch: UpdateActivityPayload
): Promise<Activity> {
  const res = await apiFetch(`${API_BASE}/api/activities/${activityId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function deleteActivity(activityId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/activities/${activityId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  NOTE: "Note",
  CALL: "Appel",
  MEETING: "RDV",
  EMAIL: "Email",
  STATUS_CHANGE: "Statut",
  STAGE_CHANGE: "Pipeline",
  ADDRESS_VERIFIED: "Adresse validée",
  PROJECT_STATUS_CHANGE: "Statut projet",
  DEVIS_SIGNE: "Devis signé",
  INSTALLATION_TERMINEE: "Installation terminée",
};
