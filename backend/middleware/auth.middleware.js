import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth.js";
import { pool } from "../config/db.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import {
  userIsLiveSuperAdminByDb,
  sendSuperAdminJwtStale,
} from "../lib/superAdminUserGuards.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * CP-078 — SUPER_ADMIN : x-organization-id remplace l’organisation du JWT si l’UUID existe en base.
 */
async function applySuperAdminOrganizationOverride(req) {
  if (req.user?.role !== "SUPER_ADMIN") return;

  const raw = req.headers["x-organization-id"] ?? req.headers["X-Organization-Id"];
  const headerOrg = Array.isArray(raw) ? raw[0] : raw;
  if (!headerOrg || typeof headerOrg !== "string") return;

  const trimmed = headerOrg.trim();
  if (!UUID_RE.test(trimmed)) {
    const err = new Error("x-organization-id invalide");
    err.statusCode = 400;
    err.code = "INVALID_ORG_HEADER";
    throw err;
  }

  const jwtOrg = req.user.organizationId ?? req.user.organization_id;
  const r = await pool.query("SELECT id FROM organizations WHERE id = $1 LIMIT 1", [trimmed]);
  if (r.rows.length === 0) {
    const err = new Error("Organisation inconnue");
    err.statusCode = 400;
    err.code = "UNKNOWN_ORG_HEADER";
    throw err;
  }

  if (String(trimmed) !== String(jwtOrg ?? "")) {
    void logAuditEvent({
      action: AuditActions.ORG_SUPER_ADMIN_CONTEXT,
      entityType: "organization",
      entityId: trimmed,
      organizationId: trimmed,
      userId: req.user?.userId ?? req.user?.id ?? null,
      req,
      statusCode: 200,
      metadata: {
        jwt_organization_id: jwtOrg ?? null,
        effective_organization_id: trimmed,
      },
    });
  }

  req.user.organizationId = trimmed;
  req.user.organization_id = trimmed;
}

/**
 * CP-078B — SUPER_ADMIN : POST/PUT/PATCH/DELETE interdits sans `x-super-admin-edit: 1`.
 * Utilise req.user si présent, sinon tryParseJwtUser(req).
 *
 * Important : le fallback tryParseJwtUser ne passe pas par verifyJWT (pas de revalidation DB du rôle).
 * Toute route qui s’appuie sur ce fallback pour un SUPER_ADMIN doit appeler avant
 * userIsLiveSuperAdminByDb (ex. respondWithDpPdfOrJson).
 *
 * @returns {boolean} true si la réponse 403 a été envoyée.
 */
export function enforceSuperAdminWriteAccess(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }

  const url = String(req.originalUrl || req.url || "");
  if (url.includes("/api/organizations/super-admin/org-switch-audit")) {
    return false;
  }

  const u = req.user ?? tryParseJwtUser(req);
  if (!u || u.role !== "SUPER_ADMIN") {
    return false;
  }

  const raw = req.headers["x-super-admin-edit"] ?? req.headers["X-Super-Admin-Edit"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  const editOn = v === "1" || v === "true" || v === 1;

  const orgEff = u.organizationId ?? u.organization_id ?? null;
  const uid = u.userId ?? u.id ?? null;

  if (editOn) {
    void logAuditEvent({
      action: AuditActions.SUPER_ADMIN_EDIT_MODE_ENABLED,
      entityType: "system",
      organizationId: orgEff,
      userId: uid,
      req,
      statusCode: 200,
      metadata: {
        method,
        route: req.originalUrl || req.url || req.path,
      },
    });
    return false;
  }

  void logAuditEvent({
    action: AuditActions.SUPER_ADMIN_READ_ONLY_BLOCK,
    entityType: "system",
    organizationId: orgEff,
    userId: uid,
    req,
    statusCode: 403,
    metadata: {
      method,
      route: req.originalUrl || req.url || req.path,
    },
  });
  res.status(403).json({
    error:
      "Mode support lecture seule : les écritures sont interdites. Activez explicitement le mode édition (en-tête x-super-admin-edit).",
    code: "SUPER_ADMIN_READ_ONLY",
  });
  return true;
}

export async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId ?? decoded.id;
    const organizationId = decoded.organizationId ?? decoded.organization_id;
    req.user = {
      ...decoded,
      userId,
      id: userId,
      organizationId,
      organization_id: organizationId,
      /** Toujours l’organisation du JWT (avant override SUPER_ADMIN x-organization-id). */
      jwtOrganizationId: organizationId,
      jwt_organization_id: organizationId,
    };

    if (req.user?.role === "SUPER_ADMIN") {
      const uid = req.user.userId ?? req.user.id;
      if (!uid || !(await userIsLiveSuperAdminByDb(pool, uid))) {
        return sendSuperAdminJwtStale(res);
      }
    }

    await applySuperAdminOrganizationOverride(req);
    if (enforceSuperAdminWriteAccess(req, res)) {
      return;
    }
    next();
  } catch (e) {
    if (e?.statusCode === 400) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    if (e?.name === "JsonWebTokenError" || e?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token invalide ou expiré" });
    }
    console.error("verifyJWT", e);
    return res.status(500).json({ error: "Erreur d'authentification" });
  }
}

/**
 * JWT optionnel (ex. routes PDF DP : enregistrement document si Bearer présent).
 * @returns {{ userId: string, id: string, organizationId: string, organization_id: string } & Record<string, unknown> | null}
 */
export function tryParseJwtUser(req) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId ?? decoded.id;
    const organizationId = decoded.organizationId ?? decoded.organization_id;
    return {
      ...decoded,
      userId,
      id: userId,
      organizationId,
      organization_id: organizationId,
    };
  } catch {
    return null;
  }
}
