import { pool } from "../config/db.js";
import { comparePassword, generateJWT } from "./auth.service.js";
import logger from "../app/core/logger.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import {
  checkLoginFailuresAllowed,
  recordLoginFailure,
  resetLoginFailures,
} from "../middleware/security/loginRateLimit.helper.js";
import { resolveEffectiveHighestRole } from "../lib/superAdminUserGuards.js";
import { syncAdminRbacOnLogin } from "../rbac/rbac.service.js";

/** Aligné sur auth.middleware (validation organizationId login). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function login(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.log("LOGIN START");
    const b = req.body ?? {};
    console.log("LOGIN BODY:", { ...b, password: b.password ? "[redacted]" : undefined });
  }

  const { email, password } = req.body ?? {};
  const bodyOrgRaw = req.body?.organizationId ?? req.body?.organization_id;
  const bodyOrganizationId =
    typeof bodyOrgRaw === "string" ? bodyOrgRaw.trim() : "";

  if (!email || !password) {
    return res.status(400).json({ error: "email et password requis" });
  }

  const emailNorm = String(email).toLowerCase().trim();
  if (!(await checkLoginFailuresAllowed(req, res, emailNorm))) {
    return;
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT u.id, u.email, u.organization_id, u.password_hash, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE LOWER(TRIM(u.email)) = $1 AND u.status = 'active'
       ORDER BY u.created_at ASC`,
      [emailNorm]
    );

    if (result.rows.length === 0) {
      await recordLoginFailure(req, emailNorm);
      void logAuditEvent({
        action: AuditActions.AUTH_LOGIN_FAILURE,
        entityType: "auth",
        organizationId: null,
        userId: null,
        req,
        statusCode: 401,
        metadata: { login_failure_reason: "unknown_user" },
      });
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    /**
     * Contrainte DB : UNIQUE (organization_id, email). Plusieurs lignes = même email dans des orgs différentes.
     * Si le même mot de passe a été réutilisé, plusieurs lignes peuvent valider bcrypt : il faut désambiguïser
     * (organizationId dans le body), sinon 409 LOGIN_ORG_AMBIGUOUS.
     * Ancien bug : `ORDER BY created_at DESC` + `break` au premier match → compte le plus récent gagnait toujours.
     */
    const passwordMatches = [];
    for (const row of result.rows) {
      if (!row?.password_hash || typeof row.password_hash !== "string") continue;
      let valid = false;
      try {
        valid = await comparePassword(password, row.password_hash);
      } catch (bcryptErr) {
        console.error("LOGIN BCRYPT ERROR:", {
          message: bcryptErr?.message,
          userId: row.id
        });
        if (!res.headersSent) {
          return res.status(500).json({ error: "Erreur vérification mot de passe", code: "BCRYPT_COMPARE" });
        }
        return;
      }
      if (valid) passwordMatches.push(row);
    }

    let user = null;
    if (passwordMatches.length === 1) {
      user = passwordMatches[0];
    } else if (passwordMatches.length > 1) {
      if (!bodyOrganizationId) {
        return res.status(409).json({
          error:
            "Plusieurs comptes actifs pour cet email. Choisissez l’organisation ou indiquez organizationId.",
          code: "LOGIN_ORG_AMBIGUOUS",
          organizations: passwordMatches.map((m) => ({
            id: m.organization_id,
            name: m.organization_name ?? null
          }))
        });
      }
      if (!UUID_RE.test(bodyOrganizationId)) {
        return res.status(400).json({ error: "organizationId invalide", code: "INVALID_ORG_ID" });
      }
      user = passwordMatches.find((m) => String(m.organization_id) === bodyOrganizationId) ?? null;
      if (!user) {
        await recordLoginFailure(req, emailNorm);
        void logAuditEvent({
          action: AuditActions.AUTH_LOGIN_FAILURE,
          entityType: "auth",
          organizationId: null,
          userId: null,
          req,
          statusCode: 401,
          metadata: { login_failure_reason: "org_mismatch_multi_account_email" }
        });
        return res.status(401).json({ error: "Identifiants invalides" });
      }
    }

    if (!user) {
      await recordLoginFailure(req, emailNorm);
      void logAuditEvent({
        action: AuditActions.AUTH_LOGIN_FAILURE,
        entityType: "auth",
        organizationId: null,
        userId: null,
        req,
        statusCode: 401,
        metadata: { login_failure_reason: "bad_password" },
      });
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    const role = await resolveEffectiveHighestRole(client, user.id);
    if (!role) {
      logger.warn("LOGIN_NO_ROLE", { userId: user.id });
      await recordLoginFailure(req, emailNorm);
      void logAuditEvent({
        action: AuditActions.AUTH_LOGIN_FAILURE,
        entityType: "user",
        entityId: user.id,
        organizationId: user.organization_id,
        userId: user.id,
        req,
        statusCode: 401,
        metadata: { login_failure_reason: "no_role" },
      });
      return res.status(401).json({ error: "Identifiants invalides" });
    }
    user.role = role;

    await syncAdminRbacOnLogin(client, user.id, user.organization_id);

    await client.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    );

    await resetLoginFailures(req, emailNorm);

    const token = generateJWT(user);
    void logAuditEvent({
      action: AuditActions.AUTH_LOGIN_SUCCESS,
      entityType: "user",
      entityId: user.id,
      organizationId: user.organization_id,
      userId: user.id,
      targetLabel: user.email,
      req,
      statusCode: 200,
      metadata: { role },
    });
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id
      }
    });
  } catch (err) {
    console.error("LOGIN ERROR FULL:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name
    });
    logger.error("LOGIN_ERROR", { err: err?.message, stack: err?.stack });
    if (!res.headersSent) {
      const message = err?.message || (err && String(err)) || "Erreur serveur";
      return res.status(500).json({ error: message });
    }
  } finally {
    if (client) client.release();
  }
}
