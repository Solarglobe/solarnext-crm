/**
 * CP-036 — Service Études (Hub Client)
 */

import { apiFetch } from "./api";

const API_BASE = import.meta.env?.VITE_API_URL || "";

export interface Study {
  id: string;
  study_number: string;
  title?: string | null;
  status?: string;
  lead_id?: string;
  current_version?: number;
  created_at: string;
  updated_at?: string;
  /** Cartes lead — version courante (JOIN API list) */
  latest_version_id?: string | null;
  latest_version_locked?: boolean;
  has_scenarios_v2?: boolean;
  calpinage_power_kwc?: number | string | null;
  scenario_hardware_kwc?: number | string | null;
  quote_has_signed?: boolean;
  quote_exists?: boolean;
}

export async function fetchStudiesByLeadId(leadId: string): Promise<Study[]> {
  const res = await apiFetch(`${API_BASE}/api/studies?lead_id=${encodeURIComponent(leadId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function fetchStudiesByClientId(clientId: string): Promise<Study[]> {
  const res = await apiFetch(`${API_BASE}/api/studies?client_id=${encodeURIComponent(clientId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function createStudy(payload: {
  lead_id: string;
  title?: string;
  /** Compteur lié à l’étude (multi-compteur) ; sinon le serveur prend le compteur par défaut du lead. */
  selected_meter_id?: string;
  data?: Record<string, unknown>;
}): Promise<{ study: Study; versions?: { version_number: number; id: string }[] }> {
  const res = await apiFetch(`${API_BASE}/api/studies`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const text = await res.text();
  if (!text || text.trim() === "") {
    throw new Error("Réponse vide du serveur (empty body)");
  }
  let json: { study?: Study; versions?: { version_number: number; id: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Réponse serveur invalide (JSON invalide)");
  }
  if (!json?.study?.id) {
    console.error("[studies.service] createStudy: réponse invalide", { raw: text.slice(0, 200), json });
    throw new Error("Réponse serveur invalide : study.id manquant");
  }
  return json as { study: Study; versions?: { version_number: number; id: string }[] };
}

export async function createStudyVersion(
  studyId: string
): Promise<{ version_number: number; id: string }> {
  const res = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions`, {
    method: "POST",
    body: JSON.stringify({ data: {} }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  const json = await res.json();
  const versions = json?.versions ?? [];
  const last = versions[versions.length - 1];
  if (!last?.version_number) {
    throw new Error("Version non créée");
  }
  return { version_number: last.version_number, id: last.id };
}

/**
 * Nouvelle version d’étude avec merge sur data_json (ex. selected_meter_id).
 * Réponse complète GET study : permet de récupérer l’UUID de la version courante.
 */
export async function postStudyVersionDataMerge(
  studyId: string,
  data: Record<string, unknown>
): Promise<StudyWithVersions> {
  const res = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return (await res.json()) as StudyWithVersions;
}

/** Données version (API GET study) — incl. traçabilité calcul multi-compteur. */
export type StudyVersionDataJson = {
  meter_snapshot?: { name?: string | null; selected_meter_id?: string | null };
  meter_snapshot_captured_at?: string | null;
  meter_snapshot_previous?: unknown;
  meter_snapshot_previous_captured_at?: string | null;
  meter_calc_change_lines_fr?: string[];
  calc_result?: { computed_at?: string | null };
  [key: string]: unknown;
};

export interface StudyWithVersions {
  study: Study;
  versions?: Array<{ id: string; version_number: number; data?: StudyVersionDataJson }>;
  lead?: unknown;
}

export async function duplicateStudy(studyId: string): Promise<StudyWithVersions> {
  const res = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}/duplicate`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function patchStudyTitle(
  studyId: string,
  titleOrPayload: string | { title: string }
): Promise<StudyWithVersions> {
  const payload =
    typeof titleOrPayload === "string" ? { title: titleOrPayload } : titleOrPayload;
  const res = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

/** Fork version déverrouillée (copie données / calpinage / snapshot éco). */
export async function forkStudyVersionApi(
  studyId: string,
  versionId: string
): Promise<{ id: string; version_number: number }> {
  const res = await apiFetch(
    `${API_BASE}/api/studies/${encodeURIComponent(studyId)}/versions/${encodeURIComponent(versionId)}/fork`,
    { method: "POST" }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
  return res.json();
}

export async function deleteStudy(studyId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/studies/${encodeURIComponent(studyId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Erreur ${res.status}`);
  }
}
