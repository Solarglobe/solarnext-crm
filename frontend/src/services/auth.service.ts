import { buildApiUrl } from "@/config/crmApiBase";
import { getAuthToken } from "./api";

const TOKEN_KEY = "solarnext_token";

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    organizationId: string;
  };
}

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  const res = await fetch(buildApiUrl("/auth/login"), {
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
  localStorage.removeItem("solarnext_current_organization_id");
  localStorage.removeItem("solarnext_super_admin");
  localStorage.removeItem("solarnext_super_admin_edit_mode");
  window.location.href = "/login";
}

/**
 * Décode le payload d'un JWT sans vérifier la signature (côté client uniquement).
 * Retourne null si le token est malformé.
 */
function decodeJwtPayloadRaw(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padLen);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  const raw = decodeJwtPayloadRaw(token);
  if (!raw) return null;
  return { exp: typeof raw.exp === "number" ? raw.exp : undefined };
}

/**
 * Payload JWT (CP-078 : organisation / rôle) — ne pas utiliser pour des décisions de sécurité critiques.
 */
export function decodeJwtPayloadUnsafe(token: string): {
  exp?: number;
  organizationId?: string;
  role?: string;
  userId?: string;
} | null {
  const raw = decodeJwtPayloadRaw(token);
  if (!raw) return null;
  const organizationId =
    (typeof raw.organizationId === "string" && raw.organizationId) ||
    (typeof raw.organization_id === "string" && raw.organization_id) ||
    undefined;
  const userId =
    (typeof raw.userId === "string" && raw.userId) ||
    (typeof raw.id === "string" && raw.id) ||
    undefined;
  return {
    exp: typeof raw.exp === "number" ? raw.exp : undefined,
    organizationId,
    role: typeof raw.role === "string" ? raw.role : undefined,
    userId,
  };
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
  firstName?: string | null;
  lastName?: string | null;
  /** Prénom + nom ou email */
  name?: string;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const res = await fetch(buildApiUrl("/auth/me"), {
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
  const res = await fetch(buildApiUrl("/auth/permissions"), {
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
    },
  });
  if (!res.ok) throw new Error("Non authentifié");
  return res.json();
}
