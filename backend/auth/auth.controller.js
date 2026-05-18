import { pool } from "../config/db.js";
import {
  clearRefreshCookie,
  comparePassword,
  createPasswordResetToken,
  createEmailVerificationToken,
  createRefreshSession,
  findValidPasswordResetToken,
  hashPassword,
  listActiveRefreshSessions,
  readRefreshTokenFromCookie,
  refreshCookieOptions,
  revokeOtherRefreshSessions,
  revokeAllRefreshSessionsForUser,
  revokeRefreshSessionById,
  revokeRefreshSession,
  rotateRefreshSession,
  validateResetPasswordPolicy,
  verifyEmailToken,
} from "./auth.service.js";
import {
  sendEmailVerificationEmail,
  sendNewSessionAlertEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../services/mail.service.js";
import {
  buildTotpQrDataUrl,
  buildOtpAuthUrl,
  createMfaTempToken,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyMfaTempToken,
  verifyTotpCode,
} from "../services/mfa.service.js";
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
import { ensureLegacyRoleAndUserBridge } from "../services/rbac/legacyRoleBridge.service.js";

/** Aligné sur auth.middleware (validation organizationId login). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, max = 255) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : "";
}

function isSolarglobeHomeAccount(row) {
  const orgName = String(row?.organization_name ?? "").toLowerCase();
  const email = String(row?.email ?? "").toLowerCase();
  return orgName.includes("solarglobe") || email.endsWith("@solarglobe.fr");
}

function applySolarglobeHomeExemption(user) {
  if (!isSolarglobeHomeAccount(user)) return user;
  return {
    ...user,
    onboarding_completed: true,
    plan_id: "INTERNAL_FREE",
    internal_home_organization: true,
  };
}

function splitName(fullName) {
  const parts = cleanText(fullName, 200).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

function cguAccepted(body) {
  return body?.acceptCgu === true || body?.acceptedCgu === true || body?.cguAccepted === true;
}

function notifyNewSessionIfNeeded(user, session) {
  if (!session?.securityAlert || !user?.email) return;
  sendNewSessionAlertEmail({
    to: user.email,
    location: session.securityAlert.countryHint || session.securityAlert.ipAddress || "lieu inconnu",
    device: session.securityAlert.deviceHint || "appareil inconnu",
  }).catch((err) => {
    logger.warn("AUTH_NEW_SESSION_ALERT_FAILED", { err: err?.message, userId: user.id });
  });
}

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
              o.name AS organization_name,
              COALESCE(o.onboarding_completed, false) AS onboarding_completed,
              COALESCE(o.require_mfa, false) AS organization_require_mfa,
              COALESCE(u.mfa_enabled, false) AS mfa_enabled,
              u.mfa_secret
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
    user = applySolarglobeHomeExemption(user);

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

    if (user.mfa_enabled === true) {
      return res.json({
        mfaRequired: true,
        mfaToken: createMfaTempToken(user),
      });
    }
    if (user.organization_require_mfa === true) {
      return res.status(403).json({
        error: "MFA obligatoire pour cette organisation. Activez le MFA avant de poursuivre.",
        code: "MFA_ENROLLMENT_REQUIRED",
      });
    }

    try {
      await syncAdminRbacOnLogin(client, user.id, user.organization_id);
    } catch (syncErr) {
      logger.warn("LOGIN_RBAC_SYNC_SKIPPED", { err: syncErr?.message, userId: user.id });
    }

    await client.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    );

    await resetLoginFailures(req, emailNorm);

    const session = await createRefreshSession(user, req, client);
    notifyNewSessionIfNeeded(user, session);
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
        onboardingCompleted: user.onboarding_completed === true,
        planId: user.plan_id ?? null,
        internalHomeOrganization: user.internal_home_organization === true,
        mfaEnabled: user.mfa_enabled === true,
        organizationRequiresMfa: user.organization_require_mfa === true,
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

const authUserId = (req) => req.user?.userId ?? req.user?.id;
const authOrgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

export async function getMfaStatus(req, res) {
  try {
    const uid = authUserId(req);
    const org = authOrgId(req);
    if (!uid || !org) return res.status(401).json({ error: "Non authentifie" });
    const result = await pool.query(
      `SELECT COALESCE(u.mfa_enabled, false) AS mfa_enabled,
              COALESCE(o.require_mfa, false) AS organization_require_mfa
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1 AND u.organization_id = $2`,
      [uid, org]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Utilisateur non trouve" });
    res.json({
      enabled: result.rows[0].mfa_enabled === true,
      organizationRequiresMfa: result.rows[0].organization_require_mfa === true,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function startMfaSetup(req, res) {
  try {
    const uid = authUserId(req);
    const org = authOrgId(req);
    if (!uid || !org) return res.status(401).json({ error: "Non authentifie" });
    const userRes = await pool.query(
      "SELECT id, email, COALESCE(mfa_enabled, false) AS mfa_enabled FROM users WHERE id = $1 AND organization_id = $2",
      [uid, org]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: "Utilisateur non trouve" });
    if (user.mfa_enabled) return res.status(409).json({ error: "MFA deja active", code: "MFA_ALREADY_ENABLED" });

    const secret = generateTotpSecret();
    await pool.query("UPDATE users SET mfa_setup_secret = $1 WHERE id = $2", [secret, uid]);
    const otpauthUrl = buildOtpAuthUrl({ secret, email: user.email });
    const qrCodeDataUrl = await buildTotpQrDataUrl({ secret, email: user.email });
    res.json({ secret, manualKey: secret, otpauthUrl, qrCodeDataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function confirmMfaSetup(req, res) {
  const uid = authUserId(req);
  const org = authOrgId(req);
  const code = req.body?.code;
  if (!uid || !org) return res.status(401).json({ error: "Non authentifie" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query(
      `SELECT id, mfa_setup_secret, COALESCE(mfa_enabled, false) AS mfa_enabled
       FROM users
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [uid, org]
    );
    const user = userRes.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utilisateur non trouve" });
    }
    if (user.mfa_enabled) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "MFA deja active", code: "MFA_ALREADY_ENABLED" });
    }
    if (!user.mfa_setup_secret) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Setup MFA non initialise", code: "MFA_SETUP_NOT_STARTED" });
    }
    if (!verifyTotpCode({ secret: user.mfa_setup_secret, code })) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Code MFA invalide", code: "MFA_CODE_INVALID" });
    }

    const recoveryCodes = generateRecoveryCodes(10);
    await client.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [uid]);
    for (const recoveryCode of recoveryCodes) {
      await client.query(
        "INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)",
        [uid, hashRecoveryCode(recoveryCode)]
      );
    }
    await client.query(
      `UPDATE users
       SET mfa_enabled = true,
           mfa_secret = mfa_setup_secret,
           mfa_setup_secret = NULL,
           mfa_enabled_at = now()
       WHERE id = $1`,
      [uid]
    );
    await client.query("COMMIT");
    void logAuditEvent({
      action: AuditActions.MFA_ENABLED,
      entityType: "user",
      entityId: uid,
      organizationId: org,
      userId: uid,
      req,
      statusCode: 200,
    });
    res.json({ enabled: true, recoveryCodes });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

async function consumeRecoveryCode(client, userId, code) {
  const codeHash = hashRecoveryCode(code);
  const result = await client.query(
    `SELECT id FROM mfa_recovery_codes
     WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
     FOR UPDATE`,
    [userId, codeHash]
  );
  const row = result.rows[0];
  if (!row) return false;
  await client.query("UPDATE mfa_recovery_codes SET used_at = now() WHERE id = $1", [row.id]);
  return true;
}

export async function verifyMfaLogin(req, res) {
  const decoded = verifyMfaTempToken(req.body?.mfaToken);
  const code = req.body?.code;
  if (!decoded) return res.status(401).json({ error: "Session MFA expiree", code: "MFA_TOKEN_INVALID" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query(
      `SELECT u.id, u.email, u.organization_id, u.status,
              COALESCE(u.email_verified, false) AS email_verified,
              COALESCE(u.mfa_enabled, false) AS mfa_enabled,
              u.mfa_secret,
              o.name AS organization_name,
              COALESCE(o.onboarding_completed, false) AS onboarding_completed,
              COALESCE(o.require_mfa, false) AS organization_require_mfa
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE u.id = $1 AND u.organization_id = $2
       FOR UPDATE`,
      [decoded.userId, decoded.organizationId]
    );
    const user = userRes.rows[0];
    if (!user || user.status !== "active" || !user.mfa_enabled || !user.mfa_secret) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "MFA non disponible", code: "MFA_NOT_AVAILABLE" });
    }

    const totpOk = verifyTotpCode({ secret: user.mfa_secret, code });
    const backupOk = totpOk ? false : await consumeRecoveryCode(client, user.id, code);
    if (!totpOk && !backupOk) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Code MFA invalide", code: "MFA_CODE_INVALID" });
    }

    user.role = decoded.role;
    Object.assign(user, applySolarglobeHomeExemption(user));
    const session = await createRefreshSession(user, req, client);
    notifyNewSessionIfNeeded(user, session);
    await client.query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
    await client.query("COMMIT");
    res.cookie("solarnext_refresh_token", session.refreshToken, refreshCookieOptions());
    return res.json({
      token: session.accessToken,
      accessToken: session.accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id,
        emailVerified: user.email_verified === true,
        onboardingCompleted: user.onboarding_completed === true,
        planId: user.plan_id ?? null,
        internalHomeOrganization: user.internal_home_organization === true,
        mfaEnabled: true,
        organizationRequiresMfa: user.organization_require_mfa === true,
      },
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

export async function disableMfa(req, res) {
  const uid = authUserId(req);
  const org = authOrgId(req);
  const password = String(req.body?.password ?? "");
  const code = req.body?.code;
  if (!uid || !org) return res.status(401).json({ error: "Non authentifie" });
  if (!password || !code) return res.status(400).json({ error: "Mot de passe et code requis" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRes = await client.query(
      `SELECT id, password_hash, COALESCE(mfa_enabled, false) AS mfa_enabled, mfa_secret
       FROM users
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [uid, org]
    );
    const user = userRes.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utilisateur non trouve" });
    }
    if (!(await comparePassword(password, user.password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Mot de passe invalide", code: "PASSWORD_INVALID" });
    }
    if (!user.mfa_enabled || !user.mfa_secret || !verifyTotpCode({ secret: user.mfa_secret, code })) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Code MFA invalide", code: "MFA_CODE_INVALID" });
    }
    await client.query(
      `UPDATE users
       SET mfa_enabled = false, mfa_secret = NULL, mfa_setup_secret = NULL, mfa_enabled_at = NULL
       WHERE id = $1`,
      [uid]
    );
    await client.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [uid]);
    await client.query("COMMIT");
    void logAuditEvent({
      action: AuditActions.MFA_DISABLED,
      entityType: "user",
      entityId: uid,
      organizationId: org,
      userId: uid,
      req,
      statusCode: 200,
    });
    res.json({ enabled: false });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

export async function listSessions(req, res) {
  try {
    const uid = authUserId(req);
    const currentSessionId = req.user?.sessionId ?? req.user?.session_id;
    if (!uid || !currentSessionId) return res.status(401).json({ error: "Non authentifie" });
    const sessions = await listActiveRefreshSessions(uid, currentSessionId);
    res.json({ sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function revokeSession(req, res) {
  try {
    const uid = authUserId(req);
    const currentSessionId = req.user?.sessionId ?? req.user?.session_id;
    const tokenId = String(req.params?.id ?? "").trim();
    if (!uid || !currentSessionId) return res.status(401).json({ error: "Non authentifie" });
    if (!tokenId) return res.status(400).json({ error: "Session requise" });
    const revoked = await revokeRefreshSessionById(uid, tokenId, currentSessionId);
    if (!revoked) {
      return res.status(404).json({
        error: "Session introuvable, deja revoquee ou session actuelle",
        code: "SESSION_NOT_REVOKED",
      });
    }
    void logAuditEvent({
      action: AuditActions.SESSION_REVOKED,
      entityType: "refresh_token",
      entityId: tokenId,
      organizationId: authOrgId(req),
      userId: uid,
      req,
      statusCode: 200,
    });
    res.json({ revoked: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function revokeOtherSessions(req, res) {
  try {
    const uid = authUserId(req);
    const currentSessionId = req.user?.sessionId ?? req.user?.session_id;
    if (!uid || !currentSessionId) return res.status(401).json({ error: "Non authentifie" });
    const revokedCount = await revokeOtherRefreshSessions(uid, currentSessionId);
    void logAuditEvent({
      action: AuditActions.SESSION_REVOKED_OTHERS,
      entityType: "refresh_token",
      organizationId: authOrgId(req),
      userId: uid,
      req,
      statusCode: 200,
      metadata: { revoked_count: revokedCount },
    });
    res.json({ revokedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

export async function register(req, res) {
  const body = req.body ?? {};
  const organizationName = cleanText(body.organizationName ?? body.companyName ?? body.company_name, 255);
  const adminName = cleanText(body.adminName ?? body.name ?? `${body.firstName ?? ""} ${body.lastName ?? ""}`, 200);
  const firstNameInput = cleanText(body.firstName ?? body.first_name, 100);
  const lastNameInput = cleanText(body.lastName ?? body.last_name, 100);
  const split = splitName(adminName);
  const firstName = firstNameInput || split.firstName;
  const lastName = lastNameInput || split.lastName;
  const emailNorm = String(body.email ?? "").toLowerCase().trim();
  const password = String(body.password ?? "");
  const passwordConfirm = String(body.passwordConfirm ?? body.confirmPassword ?? "");
  const phone = cleanText(body.phone, 50) || null;
  const rgeNumber = cleanText(body.rgeNumber ?? body.rge_number, 100) || null;
  const cguVersion = cleanText(body.cguVersion ?? body.cgu_version, 30) || "1.x";

  if (!organizationName || !firstName || !lastName || !emailNorm || !password) {
    return res.status(400).json({ error: "Champs obligatoires manquants", code: "REGISTER_REQUIRED_FIELDS" });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: "La confirmation du mot de passe ne correspond pas", code: "PASSWORD_CONFIRM_MISMATCH" });
  }
  const policy = validateResetPasswordPolicy(password);
  if (!policy.ok) {
    return res.status(400).json({ error: "Mot de passe invalide", code: "PASSWORD_POLICY_INVALID", details: policy.errors });
  }
  if (!cguAccepted(body)) {
    return res.status(400).json({ error: "Acceptation des CGU obligatoire", code: "CGU_REQUIRED" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingUser = await client.query("SELECT id FROM users WHERE LOWER(TRIM(email)) = $1 LIMIT 1", [emailNorm]);
    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Un compte existe deja avec cet email", code: "EMAIL_ALREADY_EXISTS" });
    }

    const settings = {
      signup: {
        source: "public_self_service",
        cgu_version: cguVersion,
        cgu_accepted_at: new Date().toISOString(),
        trial_days: 14,
      },
    };
    const orgResult = await client.query(
      `INSERT INTO organizations (name, legal_name, trade_name, email, phone, rge_number, settings_json, created_at)
       VALUES ($1, $1, $1, $2, $3, $4, $5::jsonb, now())
       RETURNING id, name`,
      [organizationName, emailNorm, phone, rgeNumber, JSON.stringify(settings)]
    );
    const org = orgResult.rows[0];

    const passwordHash = await hashPassword(password);
    const userResult = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, status, first_name, last_name, email_verified)
       VALUES ($1, $2, $3, 'active', $4, $5, false)
       RETURNING id, email, organization_id, first_name, last_name, email_verified`,
      [org.id, emailNorm, passwordHash, firstName, lastName]
    );
    const user = { ...userResult.rows[0], role: "ADMIN" };

    await client.query("SELECT sg_seed_rbac_roles_for_org($1)", [org.id]);
    const roleResult = await client.query(
      "SELECT id FROM rbac_roles WHERE organization_id = $1 AND UPPER(TRIM(code)) = 'ADMIN' LIMIT 1",
      [org.id]
    );
    const adminRoleId = roleResult.rows[0]?.id;
    if (!adminRoleId) {
      throw new Error("ADMIN_ROLE_NOT_FOUND");
    }
    await client.query(
      "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
      [user.id, adminRoleId]
    );
    await ensureLegacyRoleAndUserBridge(client, user.id, "ADMIN");

    const verification = await createEmailVerificationToken(user.id, client);
    const session = await createRefreshSession(user, req, client);
    await client.query("COMMIT");

    sendEmailVerificationEmail({ to: user.email, token: verification.token }).catch((err) => {
      logger.warn("AUTH_REGISTER_VERIFY_MAIL_FAILED", { err: err?.message, userId: user.id });
    });
    notifyNewSessionIfNeeded(user, session);
    res.cookie("solarnext_refresh_token", session.refreshToken, refreshCookieOptions());
    return res.status(201).json({
      token: session.accessToken,
      accessToken: session.accessToken,
      organization: { id: org.id, name: org.name },
      trialDays: 14,
      user: {
        id: user.id,
        email: user.email,
        role: "ADMIN",
        organizationId: org.id,
        emailVerified: false,
        onboardingCompleted: false,
        firstName,
        lastName,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    logger.error("AUTH_REGISTER_ERROR", { err: err?.message, stack: err?.stack });
    return res.status(500).json({ error: "Inscription impossible", code: "REGISTER_FAILED" });
  } finally {
    client.release();
  }
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
    void logAuditEvent({
      action: AuditActions.AUTH_PASSWORD_CHANGED,
      entityType: "user",
      entityId: row.user_id,
      organizationId: null,
      userId: row.user_id,
      req,
      statusCode: 200,
      metadata: { source: "password_reset" },
    });
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
