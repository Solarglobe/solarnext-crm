import { pool } from "../config/db.js";
import {
  clearRefreshCookie,
  comparePassword,
  createPasswordResetToken,
  createEmailVerificationToken,
  createRefreshSession,
  findValidPasswordResetToken,
  hashPassword,
  readRefreshTokenFromCookie,
  refreshCookieOptions,
  revokeAllRefreshSessionsForUser,
  revokeRefreshSession,
  rotateRefreshSession,
  validateResetPasswordPolicy,
  verifyEmailToken,
} from "./auth.service.js";
import {
  sendEmailVerificationEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../services/mail.service.js";
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
      `SELECT u.id, u.email, u.organization_id, u.password_hash,
              COALESCE(u.email_verified, false) AS email_verified,
              o.name AS organization_name
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

    const session = await createRefreshSession(user, req, client);
    res.cookie("solarnext_refresh_token", session.refreshToken, refreshCookieOptions());
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
      token: session.accessToken,
      accessToken: session.accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id,
        emailVerified: user.email_verified === true,
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

export async function refresh(req, res) {
  const token = readRefreshTokenFromCookie(req);
  if (!token) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: "Refresh token manquant", code: "REFRESH_TOKEN_MISSING" });
  }
  try {
    const session = await rotateRefreshSession(token, req);
    if (!session) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: "Refresh token invalide", code: "REFRESH_TOKEN_INVALID" });
    }
    res.cookie("solarnext_refresh_token", session.refreshToken, refreshCookieOptions());
    return res.json({
      token: session.accessToken,
      accessToken: session.accessToken,
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
        organizationId: session.user.organization_id,
        emailVerified: session.user.email_verified === true,
      },
    });
  } catch (err) {
    logger.error("AUTH_REFRESH_ERROR", { err: err?.message, stack: err?.stack });
    clearRefreshCookie(res);
    return res.status(500).json({ error: "Erreur refresh session" });
  }
}

function verifiedRedirectUrl(query) {
  const base =
    String(process.env.FRONTEND_URL || process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || "https://app.solarnext.fr")
      .replace(/\/+$/, "");
  return `${base}/dashboard?${query}`;
}

export async function verifyEmail(req, res) {
  const token = String(req.query?.token ?? "").trim();
  if (!token) {
    return res.redirect(302, verifiedRedirectUrl("verified=false&reason=missing"));
  }
  try {
    const result = await verifyEmailToken(token);
    if (!result.ok) {
      const reason = result.code === "EMAIL_VERIFY_TOKEN_EXPIRED" ? "expired" : "invalid";
      return res.redirect(302, verifiedRedirectUrl(`verified=false&reason=${reason}`));
    }
    sendWelcomeEmail({ to: result.email }).catch((err) => {
      logger.warn("AUTH_WELCOME_MAIL_FAILED", { err: err?.message, userId: result.userId });
    });
    return res.redirect(302, verifiedRedirectUrl("verified=true"));
  } catch (err) {
    logger.error("AUTH_VERIFY_EMAIL_ERROR", { err: err?.message, stack: err?.stack });
    return res.redirect(302, verifiedRedirectUrl("verified=false&reason=server"));
  }
}

export async function resendVerificationEmail(req, res) {
  const userId = req.user?.userId ?? req.user?.id;
  if (!userId) return res.status(401).json({ error: "Non authentifie" });
  try {
    const result = await pool.query(
      "SELECT id, email, COALESCE(email_verified, false) AS email_verified FROM users WHERE id = $1",
      [userId]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "Utilisateur non trouve" });
    if (user.email_verified === true) return res.json({ ok: true, alreadyVerified: true });
    const verification = await createEmailVerificationToken(user.id);
    await sendEmailVerificationEmail({ to: user.email, token: verification.token });
    return res.json({ ok: true });
  } catch (err) {
    logger.error("AUTH_RESEND_VERIFY_EMAIL_ERROR", { err: err?.message, stack: err?.stack });
    return res.status(500).json({ error: "Erreur envoi verification email" });
  }
}

export async function logout(req, res) {
  const token = readRefreshTokenFromCookie(req);
  try {
    await revokeRefreshSession(token);
  } catch (err) {
    logger.warn("AUTH_LOGOUT_REVOKE_FAILED", { err: err?.message });
  }
  clearRefreshCookie(res);
  return res.status(204).send();
}

export async function forgotPassword(req, res) {
  const emailNorm = String(req.body?.email ?? "").toLowerCase().trim();
  if (!emailNorm) {
    return res.json({ ok: true });
  }
  try {
    const result = await pool.query(
      `SELECT id, email
       FROM users
       WHERE LOWER(TRIM(email)) = $1 AND status = 'active'
       ORDER BY created_at ASC`,
      [emailNorm]
    );
    for (const user of result.rows) {
      const reset = await createPasswordResetToken(user.id);
      sendPasswordResetEmail({ to: user.email, token: reset.token }).catch((err) => {
        logger.warn("AUTH_PASSWORD_RESET_MAIL_FAILED", { err: err?.message, userId: user.id });
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error("AUTH_FORGOT_PASSWORD_ERROR", { err: err?.message, stack: err?.stack });
    return res.json({ ok: true });
  }
}

export async function validateResetPasswordToken(req, res) {
  const token = String(req.params?.token ?? "").trim();
  if (!token) {
    return res.status(400).json({ ok: false, code: "RESET_TOKEN_REQUIRED", error: "Token requis" });
  }
  try {
    const validation = await findValidPasswordResetToken(token);
    if (!validation.ok) {
      return res.status(400).json({ ok: false, code: validation.code, error: resetTokenMessage(validation.code) });
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error("AUTH_RESET_TOKEN_VALIDATE_ERROR", { err: err?.message });
    return res.status(500).json({ ok: false, error: "Erreur validation token" });
  }
}

function resetTokenMessage(code) {
  if (code === "RESET_TOKEN_EXPIRED") return "Le lien de reinitialisation a expire";
  if (code === "RESET_TOKEN_USED") return "Ce lien de reinitialisation a deja ete utilise";
  return "Lien de reinitialisation invalide";
}

export async function resetPassword(req, res) {
  const token = String(req.body?.token ?? "").trim();
  const newPassword = String(req.body?.newPassword ?? req.body?.password ?? "");
  if (!token) {
    return res.status(400).json({ ok: false, code: "RESET_TOKEN_REQUIRED", error: "Token requis" });
  }
  const policy = validateResetPasswordPolicy(newPassword);
  if (!policy.ok) {
    return res.status(400).json({
      ok: false,
      code: "PASSWORD_POLICY_INVALID",
      error: "Mot de passe invalide",
      details: policy.errors,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const validation = await findValidPasswordResetToken(token, client);
    if (!validation.ok) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, code: validation.code, error: resetTokenMessage(validation.code) });
    }
    const row = validation.token;
    const passwordHash = await hashPassword(newPassword);
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, row.user_id]);
    await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await revokeAllRefreshSessionsForUser(row.user_id, client);
    await client.query("COMMIT");
    clearRefreshCookie(res);
    sendPasswordChangedEmail({ to: row.email }).catch((err) => {
      logger.warn("AUTH_PASSWORD_CHANGED_MAIL_FAILED", { err: err?.message, userId: row.user_id });
    });
    return res.json({ ok: true });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    logger.error("AUTH_RESET_PASSWORD_ERROR", { err: err?.message, stack: err?.stack });
    return res.status(500).json({ ok: false, error: "Erreur reinitialisation mot de passe" });
  } finally {
    client.release();
  }
}
