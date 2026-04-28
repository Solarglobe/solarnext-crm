/**
 * Téléchargements GET /api/documents/:id/download avec Bearer (évite window.open / <a href> sans JWT).
 */

import { apiFetch } from "../services/api";
import { getCrmApiBase } from "@/config/crmApiBase";

export const DOCUMENT_DOWNLOAD_UNAVAILABLE =
  "Le document n'est plus disponible (fichier supprimé ou redéployé).";

/** Message utilisateur pour 401/403 ou erreurs « token » côté API. */
export const DOCUMENT_ACCESS_DENIED = "Session expirée ou accès au document refusé.";

/**
 * URL absolue CRM pour un chemin API (ex. `/api/documents/xxx/download`).
 */
export function resolveCrmApiAbsoluteUrl(pathOrUrl: string): string {
  const raw = String(pathOrUrl ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getCrmApiBase().replace(/\/$/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${base}${path}`;
}

async function getDocumentDownloadUserMessage(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    return DOCUMENT_ACCESS_DENIED;
  }
  const raw = await res.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as { error?: string };
    const err = typeof j?.error === "string" ? j.error.trim() : "";
    if (err) {
      if (/token\s*manquant|authorization|jwt/i.test(err)) {
        return DOCUMENT_ACCESS_DENIED;
      }
      return err;
    }
  } catch {
    /* pas du JSON */
  }
  const t = raw.trim();
  if (/token\s*manquant|authorization|jwt/i.test(t)) {
    return DOCUMENT_ACCESS_DENIED;
  }
  return t || DOCUMENT_DOWNLOAD_UNAVAILABLE;
}

/**
 * Si la réponse n'est pas OK : log + erreur avec message utilisateur.
 */
export function assertDocumentDownloadOk(res: Response, documentId: string): void {
  if (res.ok) return;
  console.error("[document download]", { documentId, status: res.status });
  if (res.status === 401 || res.status === 403) {
    throw new Error(DOCUMENT_ACCESS_DENIED);
  }
  throw new Error(DOCUMENT_DOWNLOAD_UNAVAILABLE);
}

/**
 * GET document avec Authorization Bearer, ouvre le PDF (ou fichier) dans un nouvel onglet via blob URL.
 * Préférer ce flux à `window.open('/api/documents/...')` qui n’envoie pas le JWT.
 */
export async function openAuthenticatedDocumentInNewTab(downloadPathOrAbsoluteUrl: string): Promise<void> {
  const url = resolveCrmApiAbsoluteUrl(downloadPathOrAbsoluteUrl);
  if (!url) {
    throw new Error(DOCUMENT_DOWNLOAD_UNAVAILABLE);
  }
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(await getDocumentDownloadUserMessage(res));
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  window.open(objUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
}
