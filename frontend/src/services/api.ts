import { applyOrganizationHeaders } from "./orgContextStorage";
import { showCrmInlineToast } from "../components/ui/crmInlineToast";
import { buildApiUrl } from "../config/crmApiBase";

/** Même clé que `auth.service` — seul stockage du JWT côté client. */
export const AUTH_TOKEN_STORAGE_KEY = "solarnext_token";
/** Jeton super-admin sauvegardé avant impersonation (restauration Quitter). */
export const AUTH_TOKEN_PRE_IMPERSONATION_KEY = "solarnext_token_pre_impersonation";
/** Métadonnées bannière / session impersonation (JSON) */
export const IMPERSONATION_META_KEY = "solarnext_impersonation_meta";
/** @deprecated utiliser IMPERSONATION_META_KEY */
export const IMPERSONATION_BANNER_KEY = "solarnext_impersonation_banner";

/** Timeout par défaut sur toutes les requêtes (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;
let accessTokenMemory: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let refreshFailureCount = 0;

export function setAuthToken(token: string | null): void {
  accessTokenMemory = token && token.trim() ? token.trim() : null;
  if (typeof window !== "undefined") {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return accessTokenMemory;
}

/**
 * Pont d'authentification pour l'outil DP legacy (dp-tool/*.js).
 * Le JWT est désormais en mémoire (plus dans localStorage) : les scripts DP
 * doivent lire le token via ce getter window, sinon leurs requêtes partent
 * sans Bearer → backend « Token manquant ».
 */
if (typeof window !== "undefined") {
  (window as unknown as { __solarnextGetAuthToken?: () => string | null }).__solarnextGetAuthToken =
    getAuthToken;
}

export function authHeaders(): HeadersInit {
  const base: Record<string, string> = { "Content-Type": "application/json" };
  applyOrganizationHeaders(base);
  return base;
}

export type ApiFetchOptions = RequestInit & {
  skipAuth?: boolean;
  /** Si true, pas de toast automatique — le composant gère l'erreur lui-même. */
  skipErrorToast?: boolean;
  /** Timeout ms (défaut 30 000). 0 = désactivé. */
  timeoutMs?: number;
};

/** Format unifié des erreurs backend */
interface ApiErrorBody {
  error?: string;
  code?: string;
  details?: Record<string, string | string[]>;
}

function pathnameOnly(url: string): string {
  try {
    if (/^https?:\/\//.test(url)) return new URL(url).pathname;
  } catch { /* ignore */ }
  const s = url.startsWith("/") ? url : `/${url}`;
  const q = s.indexOf("?");
  return q === -1 ? s : s.slice(0, q);
}

let _sessionExpiredPending = false;
function handleSessionExpired(): void {
  if (_sessionExpiredPending) return;
  _sessionExpiredPending = true;
  setAuthToken(null);
  localStorage.removeItem("solarnext_super_admin_edit_mode");
  const banner = document.createElement("div");
  banner.setAttribute("style", [
    "position:fixed","top:0","left:0","right:0","z-index:99999",
    "background:#1e293b","color:#f8fafc","text-align:center",
    "padding:12px 24px","font-size:14px","font-family:inherit",
    "box-shadow:0 2px 8px rgba(0,0,0,.4)",
  ].join(";"));
  banner.textContent = "Votre session a expiré. Vous allez être redirigé vers la connexion…";
  document.body.appendChild(banner);
  setTimeout(() => { window.location.href = "/login"; }, 2200);
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await fetch(buildApiUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        refreshFailureCount += 1;
        setAuthToken(null);
        return null;
      }
      const data = (await response.json()) as { token?: string; accessToken?: string };
      const token = data.accessToken || data.token || "";
      if (!token) {
        refreshFailureCount += 1;
        setAuthToken(null);
        return null;
      }
      refreshFailureCount = 0;
      setAuthToken(token);
      return token;
    } catch {
      refreshFailureCount += 1;
      setAuthToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function ensureAuthToken(): Promise<string | null> {
  return getAuthToken() || refreshAccessToken();
}

function shouldTryRefresh(url: string, skipAuth: boolean): boolean {
  if (skipAuth) return false;
  const path = pathnameOnly(url);
  if (path.endsWith("/auth/login") || path.endsWith("/auth/refresh") || path.endsWith("/auth/logout")) return false;
  if (path.startsWith("/api/client-portal") || path.startsWith("/api/public/")) return false;
  return true;
}

function redirectToLoginIfNeeded(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname || "";
  if (p === "/login" || p.startsWith("/login/")) return;
  window.location.href = "/login";
}

async function tryParseErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const text = await response.clone().text();
    if (!text.trim()) return null;
    const json = JSON.parse(text) as ApiErrorBody;
    return typeof json === "object" && json !== null ? json : null;
  } catch { return null; }
}

function format422Details(details: Record<string, string | string[]>): string {
  return Object.entries(details)
    .map(([field, msg]) => `${field} : ${Array.isArray(msg) ? msg.join(", ") : msg}`)
    .join(" • ");
}

async function handleHttpError(response: Response): Promise<void> {
  const status = response.status;
  const body = await tryParseErrorBody(response);

  if (status === 403) {
    showCrmInlineToast(body?.error ?? "Action non autorisée pour votre rôle.", "error", 4000);
    return;
  }
  if (status === 422) {
    if (body?.details && Object.keys(body.details).length > 0) {
      showCrmInlineToast(`Données invalides : ${format422Details(body.details)}`, "error", 6000);
    } else {
      showCrmInlineToast(body?.error ?? "Les données envoyées sont invalides. Vérifiez les champs.", "error", 5000);
    }
    return;
  }
  if (status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
    const msg = seconds && !isNaN(seconds)
      ? `Trop de requêtes — réessayez dans ${seconds} seconde${seconds > 1 ? "s" : ""}.`
      : "Trop de requêtes — veuillez patienter avant de réessayer.";
    showCrmInlineToast(msg, "warning", 5000);
    return;
  }
  if (status >= 500 && status <= 599) {
    showCrmInlineToast("Erreur serveur — notre équipe a été notifiée. Réessayez dans quelques instants.", "error", 5000);
  }
}

/**
 * Client HTTP unique CRM. Intercepteurs automatiques :
 *   401 → session expirée + redirect /login
 *   403 → toast "Action non autorisée"
 *   422 → toast erreurs de validation champ par champ
 *   429 → toast "Trop de requêtes, attendez X secondes"
 *   5xx → toast "Erreur serveur"
 *   Timeout → toast "Connexion perdue"
 *
 * La Response est toujours retournée (pas de rupture des appelants existants).
 * Passer skipErrorToast:true pour gérer soi-même.
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const {
    skipAuth = false,
    skipErrorToast = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers: optionHeaders,
    signal: callerSignal,
    ...rest
  } = options;

  let bearerToken = "";
  if (!skipAuth && typeof window !== "undefined") {
    const token = await ensureAuthToken();
    bearerToken = token != null ? String(token).trim() : "";
    if (!bearerToken) {
      if (refreshFailureCount >= 2) redirectToLoginIfNeeded();
      return Promise.reject(new Error("Token manquant — redirection vers /login"));
    }
    if (false && import.meta.env.DEV) {
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
    if (v != null && String(v) !== "") headers.set(k, String(v));
  }
  if (optionHeaders != null) {
    new Headers(optionHeaders as HeadersInit).forEach((value, key) => {
      if (value != null && String(value) !== "") headers.set(key, String(value));
    });
  }
  if (!skipAuth && bearerToken) {
    headers.delete("Authorization");
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }

  // Timeout via AbortController
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let signal: AbortSignal | undefined = callerSignal as AbortSignal | undefined;

  if (timeoutMs > 0) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller!.abort("timeout"), timeoutMs);
    if (callerSignal) {
      (callerSignal as AbortSignal).addEventListener("abort", () => controller!.abort());
    }
    signal = controller.signal;
  }

  let response: Response;
  try {
    response = await fetch(url, { credentials: "include", ...rest, headers, signal });
  } catch (err: unknown) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    if (isAbort && !skipErrorToast && controller?.signal.reason === "timeout") {
      showCrmInlineToast("Connexion perdue — vérifiez votre réseau et réessayez.", "error", 5000);
    }
    throw err;
  }
  if (timeoutId !== undefined) clearTimeout(timeoutId);

  if (response.status === 401 && shouldTryRefresh(url, skipAuth)) {
    const nextToken = await refreshAccessToken();
    if (nextToken) {
      headers.set("Authorization", `Bearer ${nextToken}`);
      response = await fetch(url, {
        credentials: "include",
        ...rest,
        headers,
        signal: callerSignal as AbortSignal | undefined,
      });
      if (response.status !== 401) return response;
    }
  }

  if (response.status === 401) {
    const path = pathnameOnly(url);
    const isPublic = path.startsWith("/api/client-portal") || path.startsWith("/api/public/");
    if (!skipAuth && !isPublic && refreshFailureCount >= 2) handleSessionExpired();
  } else if (!skipErrorToast) {
    if (response.status === 403 || response.status === 422 || response.status === 429 || (response.status >= 500 && response.status <= 599)) {
      void handleHttpError(response);
    }
  }

  return response;
}
