import { getCrmApiBase } from "@/config/crmApiBase";
import { apiFetch } from "./api";
import type {
  Installer,
  InstallerComputePayload,
  InstallerCostResult,
  InstallerListRow,
  InstallerTariffCatalog,
  InstallerTariffVersion,
  InstallerZone,
} from "../modules/installers/installers.types";

const API_BASE = getCrmApiBase();

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; message?: string; code?: string };
    const e = new Error(body.message || body.error || body.code || `Erreur ${res.status}`);
    (e as Error & { code?: string; status?: number }).code = body.code || body.error;
    (e as Error & { code?: string; status?: number }).status = res.status;
    throw e;
  }
  return data as T;
}

export async function listInstallers(params?: {
  active?: boolean | "";
  q?: string;
  department?: string;
}): Promise<InstallerListRow[]> {
  const qs = new URLSearchParams();
  if (params?.active !== "" && params?.active !== undefined) qs.set("active", String(params.active));
  if (params?.q?.trim()) qs.set("q", params.q.trim());
  if (params?.department?.trim()) qs.set("department", params.department.trim());
  const res = await apiFetch(`${API_BASE}/api/installers${qs.toString() ? `?${qs.toString()}` : ""}`, {
    skipErrorToast: true,
  });
  const json = await parseJsonOrThrow<{ data: InstallerListRow[] }>(res);
  return json.data ?? [];
}

export async function getInstaller(id: string): Promise<Installer> {
  const res = await apiFetch(`${API_BASE}/api/installers/${encodeURIComponent(id)}`, { skipErrorToast: true });
  return parseJsonOrThrow<Installer>(res);
}

export async function createInstaller(payload: Partial<Installer>): Promise<Installer> {
  const res = await apiFetch(`${API_BASE}/api/installers`, {
    method: "POST",
    body: JSON.stringify(payload),
    skipErrorToast: true,
  });
  return parseJsonOrThrow<Installer>(res);
}

export async function patchInstaller(id: string, payload: Partial<Installer>): Promise<Installer> {
  const res = await apiFetch(`${API_BASE}/api/installers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    skipErrorToast: true,
  });
  return parseJsonOrThrow<Installer>(res);
}

export async function replaceInstallerZones(id: string, zones: InstallerZone[]): Promise<InstallerZone[]> {
  const res = await apiFetch(`${API_BASE}/api/installers/${encodeURIComponent(id)}/zones`, {
    method: "PUT",
    body: JSON.stringify({ zones }),
    skipErrorToast: true,
  });
  const json = await parseJsonOrThrow<{ data: InstallerZone[] }>(res);
  return json.data ?? [];
}

export async function createInstallerTariffVersion(
  installerId: string,
  payload: { version_label: string; effective_from?: string | null; notes?: string | null }
): Promise<InstallerTariffVersion> {
  const res = await apiFetch(`${API_BASE}/api/installers/${encodeURIComponent(installerId)}/tariff-versions`, {
    method: "POST",
    body: JSON.stringify(payload),
    skipErrorToast: true,
  });
  return parseJsonOrThrow<InstallerTariffVersion>(res);
}

export async function getInstallerTariffVersion(
  installerId: string,
  versionId: string
): Promise<InstallerTariffCatalog> {
  const res = await apiFetch(
    `${API_BASE}/api/installers/${encodeURIComponent(installerId)}/tariff-versions/${encodeURIComponent(versionId)}`,
    { skipErrorToast: true }
  );
  return parseJsonOrThrow<InstallerTariffCatalog>(res);
}

export async function replaceInstallerTariffCatalog(
  installerId: string,
  versionId: string,
  payload: Record<string, unknown>
): Promise<InstallerTariffCatalog> {
  const res = await apiFetch(
    `${API_BASE}/api/installers/${encodeURIComponent(installerId)}/tariff-versions/${encodeURIComponent(versionId)}/catalog`,
    { method: "PUT", body: JSON.stringify(payload), skipErrorToast: true }
  );
  return parseJsonOrThrow<InstallerTariffCatalog>(res);
}

export async function activateInstallerTariffVersion(
  installerId: string,
  versionId: string
): Promise<InstallerTariffVersion> {
  const res = await apiFetch(
    `${API_BASE}/api/installers/${encodeURIComponent(installerId)}/tariff-versions/${encodeURIComponent(versionId)}/activate`,
    { method: "POST", skipErrorToast: true }
  );
  return parseJsonOrThrow<InstallerTariffVersion>(res);
}

export async function computeInstallerInstallationCost(
  installerId: string,
  payload: InstallerComputePayload
): Promise<InstallerCostResult> {
  const res = await apiFetch(
    `${API_BASE}/api/installers/${encodeURIComponent(installerId)}/compute-installation-cost`,
    { method: "POST", body: JSON.stringify(payload), skipErrorToast: true }
  );
  return parseJsonOrThrow<InstallerCostResult>(res);
}
