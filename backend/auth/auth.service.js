import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth.js";
import { pool } from "../config/db.js";

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_COOKIE_NAME = "solarnext_refresh_token";

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function generateJWT(user) {
  const payload = {
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    sessionId: user.sessionId ?? user.session_id ?? crypto.randomUUID(),
    planId: user.plan_id ?? user.planId ?? null,
    emailVerified: user.email_verified === true || user.emailVerified === true,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function hashEmailVerificationToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function validateResetPasswordPolicy(password) {
  const value = String(password ?? "");
  const errors = [];
  if (value.length < 8) errors.push("PASSWORD_MIN_LENGTH");
  if (!/[A-Z]/.test(value)) errors.push("PASSWORD_REQUIRES_UPPERCASE");
  if (!/[0-9]/.test(value)) errors.push("PASSWORD_REQUIRES_DIGIT");
  return { ok: errors.length === 0, errors };
}

function addDaysMs(date, ms) {
  return new Date(date.getTime() + ms);
}

function requestIpHint(req) {
  const ip = req?.ip || req?.socket?.remoteAddress || "";
  return String(ip).slice(0, 120) || null;
}

function requestUserAgentHint(req) {
  const ua = req?.headers?.["user-agent"] || "";
  return String(Array.isArray(ua) ? ua[0] : ua).slice(0, 300) || null;
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: "/",
  };
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export function readRefreshTokenFromCookie(req) {
  const raw = req?.headers?.cookie;
  if (!raw) return "";
  const parts = String(raw).split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== REFRESH_TOKEN_COOKIE_NAME) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return "";
}

export async function createRefreshSession(user, req, db = pool) {
  const sessionId = user.sessionId ?? user.session_id ?? crypto.randomUUID();
  const refreshToken = crypto.randomUUID();
  const now = new Date();
  const expiresAt = addDaysMs(now, REFRESH_TOKEN_TTL_MS);
  await db.query(
    `INSERT INTO refresh_tokens (
       user_id, token_hash, session_id, ip_hint, user_agent_hint, created_at, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      user.id,
      hashRefreshToken(refreshToken),
      sessionId,
      requestIpHint(req),
      requestUserAgentHint(req),
      now,
      expiresAt,
    ]
  );
  const accessToken = generateJWT({ ...user, sessionId });
  return { accessToken, refreshToken, sessionId, expiresAt };
}

export async function rotateRefreshSession(refreshToken, req, db = pool) {
  const tokenHash = hashRefreshToken(refreshToken);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT rt.id, rt.user_id, rt.session_id, rt.expires_at, rt.revoked_at,
              u.email, u.organization_id, u.status, COALESCE(u.email_verified, false) AS email_verified,
              COALESCE(u.mfa_enabled, false) AS mfa_enabled,
              COALESCE(o.require_mfa, false) AS organization_require_mfa
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       JOIN organizations o ON o.id = u.organization_id
       WHERE rt.token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const row = current.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now() || row.status !== "active") {
      await client.query("ROLLBACK");
      return null;
    }
    if (row.organization_require_mfa === true && row.mfa_enabled !== true) {
      await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [row.id]);
      await client.query("COMMIT");
      return null;
    }

    await client.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [row.id]);

    const user = {
      id: row.user_id,
      email: row.email,
      organization_id: row.organization_id,
      role: null,
      plan_id: null,
      email_verified: row.email_verified === true,
      mfa_enabled: row.mfa_enabled === true,
      sessionId: row.session_id,
    };
    const { resolveEffectiveHighestRole } = await import("../lib/superAdminUserGuards.js");
    user.role = await resolveEffectiveHighestRole(client, user.id);
    if (!user.role) {
      await client.query("ROLLBACK");
      return null;
    }

    const nextToken = crypto.randomUUID();
    const expiresAt = addDaysMs(new Date(), REFRESH_TOKEN_TTL_MS);
    await client.query(
      `INSERT INTO refresh_tokens (
         user_id, token_hash, session_id, ip_hint, user_agent_hint, created_at, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, now(), $6)`,
      [
        user.id,
        hashRefreshToken(nextToken),
        user.sessionId,
        requestIpHint(req),
        requestUserAgentHint(req),
        expiresAt,
      ]
    );
    await client.query("COMMIT");
    return {
      accessToken: generateJWT(user),
      refreshToken: nextToken,
      sessionId: user.sessionId,
      user,
      expiresAt,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function revokeRefreshSession(refreshToken, db = pool) {
  if (!refreshToken) return false;
  const result = await db.query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [hashRefreshToken(refreshToken)]
  );
  return result.rowCount > 0;
}

export async function revokeAllRefreshSessionsForUser(userId, db = pool) {
  const result = await db.query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId]
  );
  return result.rowCount;
}

export async function createPasswordResetToken(userId, db = pool) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashPasswordResetToken(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function findValidPasswordResetToken(token, db = pool) {
  const tokenHash = hashPasswordResetToken(token);
  const result = await db.query(
    `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at, u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
     LIMIT 1
     FOR UPDATE`,
    [tokenHash]
  );
  const row = result.rows[0];
  if (!row) return { ok: false, code: "RESET_TOKEN_INVALID" };
  if (row.used_at) return { ok: false, code: "RESET_TOKEN_USED" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, code: "RESET_TOKEN_EXPIRED" };
  }
  return { ok: true, token: row };
}

export async function createEmailVerificationToken(userId, db = pool) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.query(
    "DELETE FROM email_verification_tokens WHERE user_id = $1",
    [userId]
  );
  await db.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashEmailVerificationToken(token), expiresAt]
  );
  return { token, expiresAt };
}

export async function verifyEmailToken(token, db = pool) {
  const tokenHash = hashEmailVerificationToken(token);
  const client = db.connect ? await db.connect() : db;
  const shouldRelease = Boolean(db.connect);
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT evt.id, evt.user_id, evt.expires_at, u.email
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, code: "EMAIL_VERIFY_TOKEN_INVALID" };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, code: "EMAIL_VERIFY_TOKEN_EXPIRED" };
    }
    await client.query("UPDATE users SET email_verified = true WHERE id = $1", [row.user_id]);
    await client.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [row.user_id]);
    await client.query("COMMIT");
    return { ok: true, userId: row.user_id, email: row.email };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw e;
  } finally {
    if (shouldRelease) client.release();
  }
}

/**
 * Session super admin connecté « en tant que » une organisation (courte durée).
 * @param {{ originalAdminId: string, targetOrganizationId: string, originalAdminOrganizationId: string }} p
 */
export function generateImpersonationJWT({ originalAdminId, targetOrganizationId, originalAdminOrganizationId }) {
  const payload = {
    userId: originalAdminId,
    organizationId: targetOrganizationId,
    role: "SUPER_ADMIN_IMPERSONATION",
    originalAdminId,
    originalAdminOrganizationId,
    impersonation: true,
    impersonationType: "ORG",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}

/**
 * Impersonation d’un utilisateur réel (RBAC effectif, pas de bypass super admin).
 * @param {{ userId: string, organizationId: string, role: string, originalAdminId: string, originalAdminOrganizationId: string }} p
 */
export function generateUserImpersonationJWT({
  userId,
  organizationId,
  role,
  originalAdminId,
  originalAdminOrganizationId,
}) {
  const payload = {
    userId,
    organizationId,
    role,
    impersonation: true,
    impersonationType: "USER",
    originalAdminId,
    originalAdminOrganizationId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}
