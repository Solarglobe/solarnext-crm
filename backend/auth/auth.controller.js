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

export async function login(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.log("LOGIN START");
    const b = req.body ?? {};
    console.log("LOGIN BODY:", { ...b, password: b.password ? "[redacted]" : undefined });
  }

  const { email, password } = req.body ?? {};

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
      `SELECT u.id, u.email, u.organization_id, u.password_hash
       FROM users u
       WHERE LOWER(TRIM(u.email)) = $1 AND u.status = 'active'
       ORDER BY u.created_at DESC`,
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

    /** Plusieurs orgs peuvent partager le même email (unique = org+email) : on trouve la ligne dont le hash correspond. */
    let user = null;
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
      if (valid) {
        user = row;
        break;
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
