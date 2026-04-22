import { applyOrganizationHeaders } from "./orgContextStorage";

export function getAuthToken(): string | null {
  return localStorage.getItem("solarnext_token");
}

export function authHeaders(): HeadersInit {
  const token = getAuthToken();
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

/**
 * Affiche un toast "Session expirée" puis redirige vers /login après un court délai.
 * Appel idempotent : si une redirection est déjà en cours, ne fait rien.
 */
let _sessionExpiredPending = false;
function handleSessionExpired(): void {
  if (_sessionExpiredPending) return;
  _sessionExpiredPending = true;

  localStorage.removeItem("solarnext_token");
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
 * Client HTTP unique CRM : en-têtes JSON + org + **Authorization Bearer** obligatoire
 * (sauf `skipAuth: true`, réservé aux cas publics éventuels).
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { skipAuth = false, headers: optionHeaders, ...rest } = options;

  if (!skipAuth && typeof window !== "undefined") {
    const tokenRaw = getAuthToken();
    const token = tokenRaw != null ? String(tokenRaw).trim() : "";
    if (!token) {
      redirectToLoginIfNeeded();
      return Promise.reject(new Error("Token manquant — redirection vers /login"));
    }
    // Debug temporaire — retirer une fois le flux auth validé
    console.log("[apiFetch] JWT (debug)", `${token.slice(0, 28)}…`);
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

  if (!skipAuth) {
    const token = String(getAuthToken() ?? "").trim();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(url, {
    ...rest,
    headers,
  });

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
