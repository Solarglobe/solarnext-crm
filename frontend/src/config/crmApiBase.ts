/**
 * Base URL API pour le CRM (Vite + proxy /api en dev).
 * Chaîne vide = URLs relatives vers l’origine courante (ex. /api/... via proxy 5173).
 */
export function getCrmApiBase(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (raw != null && String(raw).trim() !== "") {
    return String(raw).replace(/\/$/, "");
  }
  return "";
}
