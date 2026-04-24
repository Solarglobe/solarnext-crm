/**
 * Base URL d’origine de l’API (sans /api, sans /api/v1).
 * Le code compose ensuite `${base}/api/...` ou `${base}/auth/...` comme sur Express.
 *
 * - `VITE_API_URL` (build) : origine explicite du backend (HTTPS, sans chemin `/api`).
 * - Dev (Vite) : si absent, chaîne vide → requêtes relatives via le proxy (`/api`, `/auth`).
 * - Build prod : définir `VITE_API_URL` sur l’hébergeur front (Vercel) ; sans cela, les URLs
 *   relatives ne pointent pas vers le backend API.
 *
 * --- Vercel (front) + API Railway (exemple) ---
 * Si `VITE_API_URL` est absent ou vide en production, le bundle ne connaît pas l’origine du backend :
 * le module DP (`loadDpTool` sans `apiBase`) retombe sur `window.location.origin` (souvent le domaine Vercel),
 * ce qui casse `PUT /api/leads/:id/dp`, PDF, cadastre, etc.
 * À ajouter dans Vercel → Project → Settings → Environment Variables → Production :
 *   VITE_API_URL=https://api.solarnext-crm.fr
 * (origine seule, sans suffixe `/api` ; adapter à l’URL HTTPS réelle de l’API déployée.)
 *
 * Si `VITE_API_URL` se termine par `/api/v1` (erreur courante), on le retire.
 */
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

/**
 * @returns origine normalisée, ou `""` pour URLs relatives (dev avec proxy, ou build sans `VITE_API_URL`).
 */
export function getCrmApiBase(): string {
  return normalizeApiOrigin(String(import.meta.env.VITE_API_URL ?? ""));
}

/**
 * Même règle que getCrmApiBase — alias explicite pour les services qui parlaient de « API_BASE ».
 */
export function getApiOrigin(): string {
  return getCrmApiBase();
}

/**
 * Si `VITE_API_URL` est vide : en **dev** seulement, repli sur l’origine de la page (proxy Vite).
 * En **prod** sans env, ne replie pas sur `window` (hébergeur front ≠ API) : retourne `""` pour forcer
 * la config explicite ou des URLs relatives explicites.
 */
export function getCrmApiBaseWithWindowFallback(): string {
  const b = getCrmApiBase();
  if (b) {
    return b;
  }
  if (import.meta.env.DEV && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

/**
 * Préfixe un chemin (`/api/...`, `/auth/...`) avec l’origine API si `VITE_API_URL` est défini ;
 * sinon retourne le chemin seul (relatif à l’hôte courant).
 */
export function buildApiUrl(path: string): string {
  const base = getCrmApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    return p;
  }
  return `${base.replace(/\/$/, "")}${p}`;
}
