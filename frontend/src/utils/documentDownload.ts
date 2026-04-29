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

function parseFilenameFromContentDisposition(headerValue: string | null): string | null {
  const raw = String(headerValue || "").trim();
  if (!raw) return null;
  const mStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(raw);
  if (mStar && mStar[1]) {
    try {
      return decodeURIComponent(mStar[1].trim().replace(/^["']|["']$/g, ""));
    } catch {
      return mStar[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  const m = /filename\s*=\s*("?)([^";]+)\1/i.exec(raw);
  return m && m[2] ? m[2].trim() : null;
}

function safePdfName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = String(name).trim();
  if (!s) return null;
  return /\.pdf$/i.test(s) ? s : `${s}.pdf`;
}

function triggerBrowserDownload(objUrl: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * GET document avec Authorization Bearer, ouvre le PDF (ou fichier) dans un nouvel onglet via blob URL.
 * Préférer ce flux à `window.open('/api/documents/...')` qui n’envoie pas le JWT.
 */
export async function openAuthenticatedDocumentInNewTab(
  downloadPathOrAbsoluteUrl: string,
  opts?: { preferredFileName?: string; alsoTriggerDownload?: boolean }
): Promise<void> {
  const url = resolveCrmApiAbsoluteUrl(downloadPathOrAbsoluteUrl);
  if (!url) {
    throw new Error(DOCUMENT_DOWNLOAD_UNAVAILABLE);
  }
  const res = await apiFetch(url);
  if (!res.ok) {
    throw new Error(await getDocumentDownloadUserMessage(res));
  }
  const blob = await res.blob();
  const filenameFromHeader = parseFilenameFromContentDisposition(res.headers.get("content-disposition"));
  const finalName = safePdfName(opts?.preferredFileName) || safePdfName(filenameFromHeader);
  const objUrl = URL.createObjectURL(blob);
  if (opts?.alsoTriggerDownload === true && finalName) {
    triggerBrowserDownload(objUrl, finalName);
  }
  window.open(objUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(objUrl), 120_000);
}
