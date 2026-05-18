import { buildApiUrl } from "../config/crmApiBase";
import { apiFetch } from "./api";

export type ActiveSession = {
  id: string;
  sessionId: string;
  deviceHint: string;
  userAgentHint?: string | null;
  ipAddress?: string | null;
  countryHint?: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

async function errorText(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export async function fetchActiveSessions(): Promise<ActiveSession[]> {
  const res = await apiFetch(buildApiUrl("/auth/sessions"));
  if (!res.ok) throw new Error(await errorText(res, "Sessions indisponibles"));
  const data = (await res.json()) as { sessions?: ActiveSession[] };
  return data.sessions ?? [];
}

export async function revokeSession(id: string): Promise<void> {
  const res = await apiFetch(buildApiUrl(`/auth/sessions/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errorText(res, "Revocation impossible"));
}

export async function revokeOtherSessions(): Promise<number> {
  const res = await apiFetch(buildApiUrl("/auth/sessions/revoke-others"), {
    method: "POST",
  });
  if (!res.ok) throw new Error(await errorText(res, "Revocation impossible"));
  const data = (await res.json()) as { revokedCount?: number };
  return data.revokedCount ?? 0;
}
