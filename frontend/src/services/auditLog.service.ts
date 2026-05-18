import { buildApiUrl } from "../config/crmApiBase";
import { apiFetch } from "./api";

export type AuditLogRow = {
  id: string;
  organization_id?: string | null;
  organization_name?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  ip_address?: string | null;
  target_label?: string | null;
  method?: string | null;
  route?: string | null;
  user_agent?: string | null;
  status_code?: number | null;
  metadata_json?: Record<string, unknown>;
  created_at: string;
};

export type AuditLogFilters = {
  action?: string;
  userId?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

function paramsFromFilters(filters: AuditLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.userId) params.set("user_id", filters.userId);
  if (filters.entityType) params.set("entity_type", filters.entityType);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  return params;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export async function fetchAuditLogs(filters: AuditLogFilters): Promise<{
  rows: AuditLogRow[];
  total: number;
  limit: number;
  offset: number;
}> {
  const qs = paramsFromFilters(filters).toString();
  const res = await apiFetch(buildApiUrl(`/api/admin/audit-log${qs ? `?${qs}` : ""}`));
  if (!res.ok) throw new Error(await readError(res, "Journal d'audit indisponible"));
  return res.json();
}

export async function downloadAuditLogCsv(filters: AuditLogFilters): Promise<Blob> {
  const qs = paramsFromFilters(filters).toString();
  const res = await apiFetch(buildApiUrl(`/api/admin/audit-log/export.csv${qs ? `?${qs}` : ""}`));
  if (!res.ok) throw new Error(await readError(res, "Export audit impossible"));
  return res.blob();
}
