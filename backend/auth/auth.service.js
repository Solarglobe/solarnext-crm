import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth.js";
import { pool } from "../config/db.js";

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_COOKIE_NAME = "solarnext_refresh_token";

function isSolarglobeHomeAccount(row) {
  const orgName = String(row?.organization_name ?? "").toLowerCase();
  const email = String(row?.email ?? "").toLowerCase();
  return orgName.includes("solarglobe") || email.endsWith("@solarglobe.fr");
}

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
  return requestIpAddress(req);
}

function requestUserAgentHint(req) {
  const ua = req?.headers?.["user-agent"] || "";
  return String(Array.isArray(ua) ? ua[0] : ua).slice(0, 300) || null;
}

function headerValue(req, name) {
  const raw = req?.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export function requestIpAddress(req) {
  const cf = headerValue(req, "cf-connecting-ip");
  const forwarded = headerValue(req, "x-forwarded-for");
  const firstForwarded = String(forwarded || "").split(",")[0]?.trim();
  const ip = cf || firstForwarded || req?.ip || req?.socket?.remoteAddress || "";
  return String(ip).replace(/^::ffff:/, "").slice(0, 120) || null;
}

export function requestCountryHint(req) {
  const country =
    headerValue(req, "cf-ipcountry") ||
    headerValue(req, "x-vercel-ip-country") ||
    headerValue(req, "x-country-code");
  return String(country || "").trim().slice(0, 120) || null;
}

export function parseDeviceHint(userAgent) {
  const ua = String(userAgent || "");
  const browser =
    /Edg\//.test(ua) ? "Edge" :
      /Chrome\//.test(ua) || /CriOS\//.test(ua) ? "Chrome" :
        /Firefox\//.test(ua) ? "Firefox" :
          /Safari\//.test(ua) ? "Safari" :
            "Navigateur inconnu";
  const os =
    /Windows NT/.test(ua) ? "Windows" :
      /iPhone|iPad|iPod/.test(ua) ? "iOS" :
        /Android/.test(ua) ? "Android" :
          /Mac OS X/.test(ua) ? "macOS" :
            /Linux/.test(ua) ? "Linux" :
              "OS inconnu";
  const device = /Mobi|Android|iPhone|iPad|iPod/.test(ua) ? "Mobile" : "Desktop";
  return `${device} - ${browser} / ${os}`.slice(0, 255);
}

function requestDeviceHint(req) {
  return parseDeviceHint(requestUserAgentHint(req));
}

async function detectNewSessionContext(db, userId, countryHint, deviceHint) {
  const previous = await db.query(
    `SELECT country_hint, device_hint
     FROM refresh_tokens
     WHERE user_id = $1
       AND created_at > now() - interval '180 days'
       AND (country_hint IS NOT NULL OR device_hint IS NOT NULL)
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  if (previous.rows.length === 0) return { isNewContext: false };
  const countryKnown = !countryHint || previous.rows.some((row) => row.country_hint === countryHint);
  const deviceKnown = !deviceHint || previous.rows.some((row) => row.device_hint === deviceHint);
  return {
    isNewContext: !countryKnown || !deviceKnown,
    newCountry: !countryKnown,
    newDevice: !deviceKnown,
  };
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
  const isNewSession = !(user.sessionId ?? user.session_id);
  const refreshToken = crypto.randomUUID();
  const now = new Date();
  const expiresAt = addDaysMs(now, REFRESH_TOKEN_TTL_MS);
  const ipAddress = requestIpAddress(req);
  const userAgentHint = requestUserAgentHint(req);
  const deviceHint = requestDeviceHint(req);
  const countryHint = requestCountryHint(req);
  const context = isNewSession
    ? await detectNewSessionContext(db, user.id, countryHint, deviceHint)
    : { isNewContext: false };
  await db.query(
    `INSERT INTO refresh_tokens (
       user_id, token_hash, session_id, ip_hint, user_agent_hint, device_hint, ip_address,
       country_hint, last_used_at, created_at, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)`,
    [
      user.id,
      hashRefreshToken(refreshToken),
      sessionId,
      ipAddress,
      userAgentHint,
      deviceHint,
      ipAddress,
      countryHint,
      now,
      expiresAt,
    ]
  );
  const accessToken = generateJWT({ ...user, sessionId });
  return {
    accessToken,
    refreshToken,
    sessionId,
    expiresAt,
    securityAlert: context.isNewContext
      ? { countryHint, deviceHint, ipAddress, newCountry: context.newCountry, newDevice: context.newDevice }
      : null,
  };
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
              o.name AS organization_name,
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
      plan_id: isSolarglobeHomeAccount(row) ? "INTERNAL_FREE" : null,
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
    const ipAddress = requestIpAddress(req);
    const userAgentHint = requestUserAgentHint(req);
    const deviceHint = requestDeviceHint(req);
    const countryHint = requestCountryHint(req);
    await client.query(
      `INSERT INTO refresh_tokens (
         user_id, token_hash, session_id, ip_hint, user_agent_hint, device_hint, ip_address,
         country_hint, last_used_at, created_at, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), $9)`,
      [
        user.id,
        hashRefreshToken(nextToken),
        user.sessionId,
        ipAddress,
        userAgentHint,
        deviceHint,
        ipAddress,
        countryHint,
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

export async function listActiveRefreshSessions(userId, currentSessionId, db = pool) {
  const result = await db.query(
    `SELECT id, session_id, device_hint, user_agent_hint, ip_address, country_hint,
            created_at, last_used_at, expires_at
     FROM refresh_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > now()
     ORDER BY COALESCE(last_used_at, created_at) DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    deviceHint: row.device_hint || parseDeviceHint(row.user_agent_hint),
    userAgentHint: row.user_agent_hint,
    ipAddress: row.ip_address,
    countryHint: row.country_hint,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || row.created_at,
    expiresAt: row.expires_at,
    current: String(row.session_id) === String(currentSessionId),
  }));
}

export async function revokeRefreshSessionById(userId, tokenId, currentSessionId, db = pool) {
  const result = await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE id = $1
       AND user_id = $2
       AND session_id <> $3
       AND revoked_at IS NULL`,
    [tokenId, userId, currentSessionId]
  );
  return result.rowCount > 0;
}

export async function revokeOtherRefreshSessions(userId, currentSessionId, db = pool) {
  const result = await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE user_id = $1
       AND session_id <> $2
       AND revoked_at IS NULL`,
    [userId, currentSessionId]
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
