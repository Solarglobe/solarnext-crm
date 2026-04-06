import { getAuthToken } from "./api";

const TOKEN_KEY = "solarnext_token";

export interface LoginResponse {
  token: string;
  user: { id: number; email: string; role: string; organizationId: number };
}

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let data: Partial<LoginResponse> & { error?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error(text.slice(0, 240) || "Erreur de connexion");
    }
  }
  if (!res.ok) {
    throw new Error(data.error || text || "Erreur de connexion");
  }
  if (!data.token) {
    throw new Error("Réponse serveur invalide (pas de token)");
  }
  localStorage.setItem(TOKEN_KEY, data.token);
  return data as LoginResponse;
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = "/crm.html/login";
}

/**
 * Décode le payload d'un JWT sans vérifier la signature (côté client uniquement).
 * Retourne null si le token est malformé.
 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url → base64 standard
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}

/**
 * Retourne true uniquement si un token est présent ET non expiré.
 * On tolère une marge de 30 s pour compenser les décalages d'horloge.
 */
export function isAuthenticated(): boolean {
  const token = getAuthToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp > nowSec - 30;
}

export interface CurrentUser {
  id: string;
  email: string;
  organizationId: string;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const res = await fetch("/auth/me", {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  });
  if (!res.ok) throw new Error("Non authentifié");
  return res.json();
}

export interface UserPermissions {
  permissions: string[];
  superAdmin?: boolean;
}

export async function getUserPermissions(): Promise<UserPermissions> {
  const res = await fetch("/auth/permissions", {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  });
  if (!res.ok) throw new Error("Non authentifié");
  return res.json();
}
