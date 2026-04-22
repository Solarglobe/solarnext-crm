/**
 * Base URL d’origine de l’API (sans /api, sans /api/v1).
 * Le code compose ensuite `${base}/api/...` ou `${base}/auth/...` comme sur Express.
 *
 * - Dev (Vite) : par défaut chaîne vide → requêtes relatives vers le proxy 5173.
 * - Prod (build) : VITE_API_URL si défini, sinon origine Railway.
 *
 * Si VITE_API_URL se termine par /api/v1 (erreur courante), on la retire car le
 * backend n’expose pas ce préfixe.
 */
const PRODUCTION_RAILWAY_ORIGIN = "https://solarnext-crm-production.up.railway.app";

function normalizeApiOrigin(raw: string): string {
  let s = String(raw).trim();
  if (!s) {
    return "";
  }
  s = s.replace(/\/$/, "");
  if (s.endsWith("/api/v1")) {
    s = s.slice(0, -"/api/v1".length);
  }
  return s;
}

export function getCrmApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return normalizeApiOrigin(String(fromEnv));
  }
  if (import.meta.env.DEV) {
    return "";
  }
  return PRODUCTION_RAILWAY_ORIGIN;
}

/**
 * Même règle que getCrmApiBase — alias explicite pour les services qui parlaient de « API_BASE ».
 */
export function getApiOrigin(): string {
  return getCrmApiBase();
}

/**
 * Dev sans VITE : base vide + navigateur → origine (ex. Vite 5173).
 * Pas de window (pré-rendu) → Railway par défaut.
 */
export function getCrmApiBaseWithWindowFallback(): string {
  const b = getCrmApiBase();
  if (b) {
    return b;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return PRODUCTION_RAILWAY_ORIGIN;
}

/**
 * Préfixe une URL de chemin (`/api/...`, `/auth/...`) avec l’origine API en prod ;
 * en dev, chaîne vide → URL relative (proxy Vite).
 */
export function buildApiUrl(path: string): string {
  const base = getCrmApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    return p;
  }
  return `${base}${p}`;
}
