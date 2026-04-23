import { applyOrganizationHeaders } from "./orgContextStorage";

/** Même clé que `auth.service` — seul stockage du JWT côté client. */
export const AUTH_TOKEN_STORAGE_KEY = "solarnext_token";
/** Jeton super-admin sauvegardé avant impersonation (restauration « Quitter »). */
export const AUTH_TOKEN_PRE_IMPERSONATION_KEY = "solarnext_token_pre_impersonation";
/** Métadonnées bannière / session impersonation (JSON) */
export const IMPERSONATION_META_KEY = "solarnext_impersonation_meta";
/** @deprecated utiliser IMPERSONATION_META_KEY */
export const IMPERSONATION_BANNER_KEY = "solarnext_impersonation_banner";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

/**
 * En-têtes de base (JSON + contexte org super-admin).
 * Le Bearer est ajouté uniquement dans `apiFetch` pour une seule source de vérité.
 */
export function authHeaders(): HeadersInit {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
  };
  applyOrganizationHeaders(base);
  return base;
}

export type ApiFetchOptions = RequestInit & { skipAuth?: boolean };

function pathnameOnly(url: string): string {
  try {
    if (/^https?:\/\//i.test(url)) {
      return new URL(url).pathname;
    }
  } catch {
    /* ignore */
  }
  const s = url.startsWith("/") ? url : `/${url}`;
  const q = s.indexOf("?");
  return q === -1 ? s : s.slice(0, q);
}

function isStudyCalpinagePersistPost(url: string, method: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  const p = pathnameOnly(url);
  return (
    p.includes("/api/studies/") &&
    p.includes("/versions/") &&
    p.endsWith("/calpinage")
  );
}

/**
 * Diagnostic POST persist calpinage : log le corps 403 sans consommer le body de `res`.
 */
export async function logCalpinagePersist403Response(res: Response): Promise<void> {
  if (res.status !== 403) return;
  const body = await res.clone().json().catch(() => null);
  const text = await res.clone().text().catch(() => null);
  console.error("[CALPINAGE 403 RESPONSE]", {
    status: res.status,
    body,
    text,
  });
}

/**
 * Affiche un toast "Session expirée" puis redirige vers /login après un court délai.
 * Appel idempotent : si une redirection est déjà en cours, ne fait rien.
 */
let _sessionExpiredPending = false;
function handleSessionExpired(): void {
  if (_sessionExpiredPending) return;
  _sessionExpiredPending = true;

  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem("solarnext_super_admin_edit_mode");

  // Affichage d'un message léger sans dépendre d'un composant React
  const banner = document.createElement("div");
  banner.setAttribute(
    "style",
    [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:99999",
      "background:#1e293b",
      "color:#f8fafc",
      "text-align:center",
      "padding:12px 24px",
      "font-size:14px",
      "font-family:inherit",
      "box-shadow:0 2px 8px rgba(0,0,0,.4)",
    ].join(";")
  );
  banner.textContent =
    "Votre session a expiré. Vous allez être redirigé vers la connexion…";
  document.body.appendChild(banner);

  setTimeout(() => {
    window.location.href = "/login";
  }, 2200);
}

function redirectToLoginIfNeeded(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname || "";
  if (p === "/login" || p.startsWith("/login/")) return;
  window.location.href = "/login";
}

/**
 * Client HTTP unique CRM : **Authorization: Bearer** obligatoire pour toute requête
 * (sauf `skipAuth: true`, réservé aux cas publics).
 *
 * Le token est relu explicitement depuis `localStorage` et l’en-tête est posé en **dernier**
 * après fusion des headers d’appel, pour qu’aucune option ne l’écrase par erreur.
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { skipAuth = false, headers: optionHeaders, ...rest } = options;

  let bearerToken = "";
  if (!skipAuth && typeof window !== "undefined") {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    bearerToken = token != null ? String(token).trim() : "";
    if (!bearerToken) {
      redirectToLoginIfNeeded();
      return Promise.reject(new Error("Token manquant — redirection vers /login"));
    }
    if (import.meta.env.DEV) {
      console.log("[apiFetch] Authorization debug — token JWT complet :", bearerToken);
    } else {
      console.log("[apiFetch] Bearer présent, longueur token :", bearerToken.length);
    }
  }

  let baseRecord: Record<string, string> = { ...(authHeaders() as Record<string, string>) };
  if (rest.body instanceof FormData) {
    const { "Content-Type": _ct, ...r } = baseRecord;
    baseRecord = r;
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(baseRecord)) {
    if (v != null && String(v) !== "") {
      headers.set(k, String(v));
    }
  }
  if (optionHeaders != null) {
    new Headers(optionHeaders as HeadersInit).forEach((value, key) => {
      if (value != null && String(value) !== "") {
        headers.set(key, String(value));
      }
    });
  }

  if (!skipAuth && bearerToken) {
    headers.delete("Authorization");
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }

  const response = await fetch(url, {
    ...rest,
    headers,
  });

  const methodForLog = String(rest.method || "GET");
  if (response.status === 403 && isStudyCalpinagePersistPost(url, methodForLog)) {
    await logCalpinagePersist403Response(response);
  }

  // Intercepteur global 401 — session expirée ou token invalide
  if (response.status === 401) {
    const path = pathnameOnly(url);
    const isPublic =
      path.startsWith("/api/client-portal") || path.startsWith("/api/public/");
    if (!skipAuth && !isPublic) {
      handleSessionExpired();
    }
  }

  return response;
}
