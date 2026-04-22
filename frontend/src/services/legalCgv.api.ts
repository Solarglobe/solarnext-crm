/**
 * CGV — /api/settings/legal/cgv
 */

import { apiFetch } from "./api";

/** Upload PDF CGV — met à jour settings (mode pdf) côté serveur. */
export async function uploadLegalCgvPdf(file: File, organizationId: string): Promise<{ id: string; file_name: string }> {
  const formData = new FormData();
  formData.append("entityType", "organization");
  formData.append("entityId", organizationId);
  formData.append("document_type", "organization_legal_cgv");
  formData.append("file", file);
  const res = await apiFetch("/api/documents", {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return { id: (data as { id: string }).id, file_name: (data as { file_name: string }).file_name };
}

export type LegalCgvMode = "html" | "pdf" | "url";

export type LegalCgvState = {
  mode: LegalCgvMode;
  html: string | null;
  pdf_document_id: string | null;
  url: string | null;
  pdf_file_name?: string | null;
};

export async function getLegalCgv(): Promise<{ ok: boolean; cgv: LegalCgvState | null }> {
  const res = await apiFetch("/api/settings/legal/cgv");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as { ok: boolean; cgv: LegalCgvState | null };
}

/** Statut PDFs RGE / décennale (organisation). */
export async function getComplementaryLegalDocsStatus(): Promise<{
  ok: boolean;
  rge: { configured: boolean; file_name: string | null };
  decennale: { configured: boolean; file_name: string | null };
}> {
  const res = await apiFetch("/api/settings/legal/complementary-docs");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as {
    ok: boolean;
    rge: { configured: boolean; file_name: string | null };
    decennale: { configured: boolean; file_name: string | null };
  };
}

/** Upload PDF RGE ou décennale (entity_documents). */
export async function uploadOrgComplementaryLegalPdf(
  file: File,
  organizationId: string,
  documentType: "organization_legal_rge" | "organization_legal_decennale"
): Promise<{ id: string; file_name: string }> {
  const formData = new FormData();
  formData.append("entityType", "organization");
  formData.append("entityId", organizationId);
  formData.append("document_type", documentType);
  formData.append("file", file);
  const res = await apiFetch("/api/documents", {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return { id: (data as { id: string }).id, file_name: (data as { file_name: string }).file_name };
}

export async function postLegalCgv(body: {
  mode: LegalCgvMode;
  html?: string | null;
  pdf_document_id?: string | null;
  url?: string | null;
}): Promise<{ ok: boolean; cgv: LegalCgvState | null }> {
  const res = await apiFetch("/api/settings/legal/cgv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as { ok: boolean; cgv: LegalCgvState | null };
}
