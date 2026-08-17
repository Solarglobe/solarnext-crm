import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";

const API_BASE = getCrmApiBase();

export type CrmTaskType = "CALL" | "EMAIL" | "ADMIN" | "POST_INSTALL" | "SAV" | "PARRAINAGE" | "OTHER";
export type CrmTaskStatus = "OPEN" | "DONE" | "SNOOZED" | "CANCELLED";
export type CrmTaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type CrmTaskCreatedFrom = "MANUAL" | "STAGE_RULE" | "INACTIVITY_RULE" | "PROJECT_RULE";
export type CrmTaskBucket = "today" | "overdue" | "week" | "all";

export interface CrmTask {
  id: string;
  organization_id: string;
  lead_id?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  assigned_user_id: string;
  type: CrmTaskType;
  title: string;
  description?: string | null;
  due_at: string;
  status: CrmTaskStatus;
  priority: CrmTaskPriority;
  created_from: CrmTaskCreatedFrom;
  automation_key?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  entity_label?: string | null;
  lead_full_name?: string | null;
  lead_company_name?: string | null;
  client_full_name?: string | null;
  client_company_name?: string | null;
  assigned_user_label?: string | null;
  assigned_user_email?: string | null;
}

export interface CrmTaskFilters {
  bucket?: CrmTaskBucket;
  status?: string;
  assigned_user_id?: string;
  type?: CrmTaskType | "";
  priority?: CrmTaskPriority | "";
  entity?: "lead" | "client" | "";
  lead_id?: string;
  client_id?: string;
  limit?: number;
  offset?: number;
}

export interface CreateCrmTaskPayload {
  lead_id?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  assigned_user_id: string;
  type: CrmTaskType;
  title: string;
  description?: string | null;
  due_at: string;
  priority?: CrmTaskPriority;
}

function paramsFromFilters(filters: CrmTaskFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  return params;
}

async function parseTaskResponse(res: Response): Promise<CrmTask> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Erreur tâche CRM");
  }
  return res.json();
}

export async function fetchCrmTasks(filters: CrmTaskFilters = {}): Promise<CrmTask[]> {
  const params = paramsFromFilters(filters);
  const qs = params.toString();
  const res = await apiFetch(qs ? `${API_BASE}/api/tasks?${qs}` : `${API_BASE}/api/tasks`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Erreur chargement relances");
  }
  const data = await res.json();
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

export async function createCrmTask(payload: CreateCrmTaskPayload): Promise<CrmTask> {
  const res = await apiFetch(`${API_BASE}/api/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseTaskResponse(res);
}

export async function updateCrmTask(id: string, payload: Partial<CreateCrmTaskPayload> & { status?: CrmTaskStatus }): Promise<CrmTask> {
  const res = await apiFetch(`${API_BASE}/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return parseTaskResponse(res);
}

export async function completeCrmTask(id: string): Promise<CrmTask> {
  const res = await apiFetch(`${API_BASE}/api/tasks/${id}/complete`, { method: "POST" });
  return parseTaskResponse(res);
}

export async function snoozeCrmTask(id: string, due_at: string): Promise<CrmTask> {
  const res = await apiFetch(`${API_BASE}/api/tasks/${id}/snooze`, {
    method: "POST",
    body: JSON.stringify({ due_at }),
  });
  return parseTaskResponse(res);
}

export async function cancelCrmTask(id: string): Promise<CrmTask> {
  const res = await apiFetch(`${API_BASE}/api/tasks/${id}/cancel`, { method: "POST" });
  return parseTaskResponse(res);
}
