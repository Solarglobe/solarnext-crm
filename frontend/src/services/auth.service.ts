import { buildApiUrl } from "@/config/crmApiBase";
import {
  apiFetch,
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_TOKEN_PRE_IMPERSONATION_KEY,
  getAuthToken,
  IMPERSONATION_BANNER_KEY,
  IMPERSONATION_META_KEY,
} from "./api";

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    organizationId: string;
  };
}

/** Plusieurs comptes actifs pour le même email (orgs différentes) — choix d’organisation requis. */
export class LoginAmbiguousError extends Error {
  readonly code = "LOGIN_ORG_AMBIGUOUS" as const;
  constructor(
    public readonly organizations: { id: string; name: string | null }[]
  ) {
    super(
      "Plusieurs comptes pour cet email. Choisissez l’organisation, puis validez à nouveau."
    );
    this.name = "LoginAmbiguousError";
  }
}

export async function login(
  email: string,
  password: string,
  organizationId?: string | null
): Promise<LoginResponse> {
  const body: Record<string, string> = { email, password };
  if (organizationId) body.organizationId = organizationId;

  const res = await fetch(buildApiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    if (res.status === 409 && data && typeof data === "object" && "code" in data) {
      const code = (data as { code?: string }).code;
      if (code === "LOGIN_ORG_AMBIGUOUS") {
        const raw = (data as { organizations?: unknown }).organizations;
        const organizations = Array.isArray(raw)
          ? raw.map((o) => {
              const row = o as { id?: string; name?: string | null };
              return {
                id: String(row.id ?? ""),
                name:
                  row.name === undefined || row.name === null
                    ? null
                    : String(row.name),
              };
            })
            .filter((o) => o.id)
          : [];
        throw new LoginAmbiguousError(organizations);
      }
    }
    throw new Error(data.error || text || "Erreur de connexion");
  }
  if (!data.token) {
    throw new Error("Réponse serveur invalide (pas de token)");
  }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
  const stored = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  console.log(
    "[auth/login] solarnext_token stocké :",
    Boolean(stored && stored.length > 0),
    "longueur :",
    stored?.length ?? 0,
    import.meta.env.DEV ? `| jeton : ${stored}` : ""
  );
  return data as LoginResponse;
}

export function logout(): void {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_TOKEN_PRE_IMPERSONATION_KEY);
  localStorage.removeItem(IMPERSONATION_BANNER_KEY);
  localStorage.removeItem(IMPERSONATION_META_KEY);
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
  impersonation?: boolean;
  impersonationType?: string;
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
    impersonation: raw.impersonation === true,
    impersonationType: typeof raw.impersonationType === "string" ? raw.impersonationType : undefined,
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
  const res = await apiFetch(buildApiUrl("/auth/me"));
  if (!res.ok) throw new Error("Non authentifié");
  return res.json();
}

export interface UserPermissions {
  permissions: string[];
  superAdmin?: boolean;
  /** Jeton d’impersonation org (super admin) */
  impersonation?: boolean;
  impersonationType?: "ORG" | "USER" | string;
}

export async function getUserPermissions(): Promise<UserPermissions> {
  const res = await apiFetch(buildApiUrl("/auth/permissions"));
  if (!res.ok) throw new Error("Non authentifié");
  return res.json();
}
