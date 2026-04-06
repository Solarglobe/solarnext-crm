export function getAuthToken(): string | null {
  return localStorage.getItem("solarnext_token");
}

export function authHeaders(): HeadersInit {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
    window.location.href = "/crm.html/login";
  }, 2200);
}

export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let base = authHeaders() as Record<string, string>;
  if (options.body instanceof FormData) {
    const { "Content-Type": _, ...rest } = base;
    base = rest;
  }
  const headers = {
    ...base,
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Intercepteur global 401 — session expirée ou token invalide
  if (response.status === 401) {
    handleSessionExpired();
  }

  return response;
}
