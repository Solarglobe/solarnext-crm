import { buildApiUrl } from "../config/crmApiBase";
import { apiFetch } from "./api";

export type MfaStatus = {
  enabled: boolean;
  organizationRequiresMfa: boolean;
};

export type MfaSetupStart = {
  secret: string;
  manualKey: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
};

async function readJsonError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export async function fetchMfaStatus(): Promise<MfaStatus> {
  const res = await apiFetch(buildApiUrl("/auth/mfa/status"));
  if (!res.ok) throw new Error(await readJsonError(res, "Statut MFA indisponible"));
  return res.json();
}

export async function startMfaSetup(): Promise<MfaSetupStart> {
  const res = await apiFetch(buildApiUrl("/auth/mfa/setup/start"), { method: "POST" });
  if (!res.ok) throw new Error(await readJsonError(res, "Initialisation MFA impossible"));
  return res.json();
}

export async function confirmMfaSetup(code: string): Promise<{ enabled: true; recoveryCodes: string[] }> {
  const res = await apiFetch(buildApiUrl("/auth/mfa/setup/confirm"), {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Activation MFA impossible"));
  return res.json();
}

export async function disableMfa(password: string, code: string): Promise<void> {
  const res = await apiFetch(buildApiUrl("/auth/mfa/disable"), {
    method: "POST",
    body: JSON.stringify({ password, code }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Desactivation MFA impossible"));
}

export async function fetchOrganizationSecurity(): Promise<{ requireMfa: boolean }> {
  const res = await apiFetch(buildApiUrl("/api/organizations/security"));
  if (!res.ok) throw new Error(await readJsonError(res, "Parametres securite indisponibles"));
  return res.json();
}

export async function updateOrganizationSecurity(requireMfa: boolean): Promise<{ requireMfa: boolean }> {
  const res = await apiFetch(buildApiUrl("/api/organizations/security"), {
    method: "PATCH",
    body: JSON.stringify({ requireMfa }),
  });
  if (!res.ok) throw new Error(await readJsonError(res, "Mise a jour securite impossible"));
  return res.json();
}
