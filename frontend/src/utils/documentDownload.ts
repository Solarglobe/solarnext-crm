/**
 * Erreurs téléchargement GET /api/documents/:id/download (blob côté client).
 */

export const DOCUMENT_DOWNLOAD_UNAVAILABLE =
  "Le document n'est plus disponible (fichier supprimé ou redéployé)";

/**
 * Si la réponse n'est pas OK : log documentId + statut HTTP, puis lève une erreur avec message utilisateur.
 */
export function assertDocumentDownloadOk(res: Response, documentId: string): void {
  if (res.ok) return;
  console.error("[document download]", { documentId, status: res.status });
  throw new Error(DOCUMENT_DOWNLOAD_UNAVAILABLE);
}
