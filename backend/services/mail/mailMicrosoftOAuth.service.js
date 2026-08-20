/**
 * OAuth Microsoft pour IMAP/SMTP XOAUTH2 (pas Graph).
 */

import crypto from "crypto";
import { pool } from "../../config/db.js";
import { encryptJson, decryptJson } from "../security/encryption.service.js";
import { canConfigureMailAccounts } from "../mailAccess.service.js";

export const MICROSOFT_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "https://outlook.office.com/SMTP.Send",
];

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function oauthConfig() {
  const clientId = String(process.env.MICROSOFT_CLIENT_ID || process.env.MAIL_MICROSOFT_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MICROSOFT_CLIENT_SECRET || process.env.MAIL_MICROSOFT_CLIENT_SECRET || "").trim();
  const tenant = String(process.env.MICROSOFT_TENANT_ID || process.env.MAIL_MICROSOFT_TENANT_ID || "common").trim();
  const redirectUri = String(process.env.MICROSOFT_REDIRECT_URI || process.env.MAIL_MICROSOFT_REDIRECT_URI || "").trim();
  const frontendUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || "").trim();
  return {
    configured: Boolean(clientId && redirectUri),
    clientId,
    clientSecret,
    tenant,
    redirectUri,
    frontendUrl,
    authorizeEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
  };
}

function oauthError(code, message, temporary = false) {
  const err = new Error(message);
  err.code = code;
  err.temporary = temporary;
  return err;
}

export function getMicrosoftOAuthPublicConfig() {
  const cfg = oauthConfig();
  return {
    configured: cfg.configured,
    scopes: MICROSOFT_OAUTH_SCOPES,
    authorizeEndpoint: cfg.authorizeEndpoint,
    tokenEndpoint: cfg.tokenEndpoint,
  };
}

export async function createMicrosoftOAuthStart(p) {
  const cfg = oauthConfig();
  if (!cfg.configured) {
    throw oauthError("MICROSOFT_OAUTH_NOT_CONFIGURED", "OAuth Microsoft non configure");
  }
  const state = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await pool.query(
    `INSERT INTO mail_account_oauth_states (
       organization_id, user_id, mail_account_id, provider, state_hash,
       code_verifier_encrypted, redirect_uri, requested_email, expires_at
     ) VALUES ($1, $2, $3, 'MICROSOFT', $4, $5::jsonb, $6, $7, $8)`,
    [
      p.organizationId,
      p.userId,
      p.mailAccountId || null,
      sha256(state),
      encryptJson({ v: 1, codeVerifier: verifier }),
      cfg.redirectUri,
      p.requestedEmail || null,
      expiresAt,
    ]
  );
  const url = new URL(cfg.authorizeEndpoint);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MICROSOFT_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString(), scopes: MICROSOFT_OAUTH_SCOPES };
}

function parseJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return {};
    const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=").replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

async function exchangeCodeForToken({ code, verifier, redirectUri }) {
  const cfg = oauthConfig();
  const body = new URLSearchParams();
  body.set("client_id", cfg.clientId);
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", verifier);
  body.set("scope", MICROSOFT_OAUTH_SCOPES.join(" "));
  const fetchImpl = arguments[0]?.fetchImpl || fetch;
  const res = await fetchImpl(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Token Microsoft ${res.status}`);
    err.code = "MICROSOFT_TOKEN_EXCHANGE_FAILED";
    throw err;
  }
  return data;
}

function normalizeScopes(scopeValue) {
  return new Set(String(scopeValue || "").split(/\s+/).map((s) => s.trim()).filter(Boolean));
}

function assertMicrosoftTokenPayload(tokens, expectedEmail = null) {
  if (!tokens?.access_token) {
    throw oauthError("MICROSOFT_ACCESS_TOKEN_MISSING", "Access token Microsoft manquant");
  }
  if (!tokens.refresh_token) {
    throw oauthError("MICROSOFT_REFRESH_TOKEN_MISSING", "Refresh token Microsoft manquant");
  }
  const granted = normalizeScopes(tokens.scope || MICROSOFT_OAUTH_SCOPES.join(" "));
  const missing = MICROSOFT_OAUTH_SCOPES.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    throw oauthError("MICROSOFT_SCOPES_INSUFFICIENT", "Scopes Microsoft insuffisants");
  }
  const claims = parseJwtPayload(tokens.id_token || tokens.access_token);
  const email = String(claims.preferred_username || claims.email || claims.upn || "").trim().toLowerCase();
  if (expectedEmail && email && email !== String(expectedEmail).trim().toLowerCase()) {
    throw oauthError("MICROSOFT_IDENTITY_MISMATCH", "Identite Microsoft differente du compte attendu");
  }
  return { claims, email };
}

export async function consumeMicrosoftOAuthCallback(p) {
  if (!p?.state || !p?.code) {
    throw oauthError("MICROSOFT_OAUTH_STATE_INVALID", "Etat OAuth ou code manquant");
  }
  const stateHash = sha256(String(p.state || ""));
  const dbPool = p.pool || pool;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const stateRes = await client.query(
      `SELECT * FROM mail_account_oauth_states
       WHERE state_hash = $1 AND provider = 'MICROSOFT'
       FOR UPDATE`,
      [stateHash]
    );
    const stateRow = stateRes.rows[0];
    if (!stateRow || stateRow.consumed_at || new Date(stateRow.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      throw oauthError("MICROSOFT_OAUTH_STATE_INVALID", "Etat OAuth invalide ou expire");
    }
    if (p.userId && String(stateRow.user_id) !== String(p.userId)) {
      await client.query("ROLLBACK");
      throw oauthError("MICROSOFT_OAUTH_SESSION_MISMATCH", "Session utilisateur differente du flow OAuth");
    }
    if (p.organizationId && String(stateRow.organization_id) !== String(p.organizationId)) {
      await client.query("ROLLBACK");
      throw oauthError("MICROSOFT_OAUTH_SESSION_MISMATCH", "Organisation differente du flow OAuth");
    }
    if (p.cookieStateHash && String(p.cookieStateHash) !== String(stateRow.state_hash)) {
      await client.query("ROLLBACK");
      throw oauthError("MICROSOFT_OAUTH_SESSION_MISMATCH", "Session navigateur differente du flow OAuth");
    }
    if (p.revalidatePermission !== false) {
      const permissionCheck = p.canConfigureMailAccountsImpl || canConfigureMailAccounts;
      const ok = await permissionCheck({
        userId: stateRow.user_id,
        organizationId: stateRow.organization_id,
      });
      if (!ok) {
        await client.query("ROLLBACK");
        throw oauthError("MICROSOFT_OAUTH_PERMISSION_REVOKED", "Permission mail retiree pendant le flow OAuth");
      }
    }
    const verifierPayload = decryptJson(stateRow.code_verifier_encrypted);
    const tokens = await exchangeCodeForToken({
      code: String(p.code || ""),
      verifier: String(verifierPayload.codeVerifier || ""),
      redirectUri: stateRow.redirect_uri,
      fetchImpl: p.fetchImpl,
    });
    const tokenIdentity = assertMicrosoftTokenPayload(tokens, stateRow.requested_email || null);
    const email = String(stateRow.requested_email || tokenIdentity.email || "").trim().toLowerCase();
    if (!email) {
      throw oauthError("MICROSOFT_EMAIL_MISSING", "Email Microsoft introuvable dans le jeton");
    }
    const expiresAt = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null;
    const encrypted = encryptJson({
      v: 1,
      oauth_provider: "MICROSOFT",
      oauth_scopes: MICROSOFT_OAUTH_SCOPES,
      oauth_access_token: tokens.access_token,
      oauth_refresh_token: tokens.refresh_token || null,
      oauth_expires_at: expiresAt ? expiresAt.toISOString() : null,
      imap_user: email,
      smtp_user: email,
    });

    let accountId = stateRow.mail_account_id;
    if (accountId) {
      await client.query(
        `UPDATE mail_accounts SET
           email = $3, provider = 'MICROSOFT', auth_method = 'MICROSOFT_OAUTH',
           imap_host = 'outlook.office365.com', imap_port = 993, imap_secure = true,
           smtp_host = 'smtp.office365.com', smtp_port = 587, smtp_secure = false,
           encrypted_credentials = $4::jsonb, lifecycle_state = 'CONNECTED',
           is_active = true, sync_enabled = true, reconnect_required = false,
           connected_at = COALESCE(connected_at, now()), disconnected_at = NULL,
           token_expires_at = $5, updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [accountId, stateRow.organization_id, email, encrypted, expiresAt]
      );
    } else {
      const existing = await client.query(
        `SELECT id FROM mail_accounts
         WHERE organization_id = $1
           AND lower(email) = lower($2)
           AND provider = 'MICROSOFT'
           AND lifecycle_state <> 'DELETED'
         FOR UPDATE`,
        [stateRow.organization_id, email]
      );
      if (existing.rows[0]) {
        accountId = existing.rows[0].id;
        await client.query(
          `UPDATE mail_accounts SET
           lifecycle_state = 'CONNECTED',
           is_active = true,
           sync_enabled = true,
           reconnect_required = false,
           auth_method = 'MICROSOFT_OAUTH',
           imap_host = 'outlook.office365.com', imap_port = 993, imap_secure = true,
           smtp_host = 'smtp.office365.com', smtp_port = 587, smtp_secure = false,
           encrypted_credentials = $3::jsonb,
           token_expires_at = $4,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
          [accountId, stateRow.organization_id, encrypted, expiresAt]
        );
      } else {
        const ins = await client.query(
          `INSERT INTO mail_accounts (
             organization_id, user_id, email, provider, auth_method, display_name,
             imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
             encrypted_credentials, is_shared, is_active, sync_enabled, lifecycle_state,
             connected_at, token_expires_at
           ) VALUES (
             $1, $2, $3, 'MICROSOFT', 'MICROSOFT_OAUTH', $3,
             'outlook.office365.com', 993, true, 'smtp.office365.com', 587, false,
             $4::jsonb, false, true, true, 'CONNECTED', now(), $5
           )
           RETURNING id`,
          [stateRow.organization_id, stateRow.user_id, email, encrypted, expiresAt]
        );
        accountId = ins.rows[0].id;
      }
    }
    await client.query(`UPDATE mail_account_oauth_states SET consumed_at = now() WHERE id = $1`, [stateRow.id]);
    await client.query("COMMIT");
    return { success: true, mailAccountId: accountId, email };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }
}

export function microsoftOAuthResultRedirect(ok, params = {}) {
  const cfg = oauthConfig();
  if (!cfg.frontendUrl) return null;
  const url = new URL("/settings/mail", cfg.frontendUrl);
  url.searchParams.set("tab", "accounts");
  url.searchParams.set("microsoftOAuth", ok ? "success" : "error");
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function exchangeRefreshToken({ refreshToken, fetchImpl }) {
  const cfg = oauthConfig();
  const body = new URLSearchParams();
  body.set("client_id", cfg.clientId);
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("scope", MICROSOFT_OAUTH_SCOPES.join(" "));
  const res = await (fetchImpl || fetch)(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data.error || "");
    if (code === "invalid_grant" || code === "interaction_required") {
      throw oauthError("MICROSOFT_REFRESH_REVOKED", "Reconnexion Microsoft requise");
    }
    throw oauthError("MICROSOFT_REFRESH_TEMPORARY_ERROR", "Refresh Microsoft temporairement indisponible", true);
  }
  return data;
}

export async function refreshMicrosoftOAuthTokenForAccount(db, p) {
  const marginMs = Number.isFinite(Number(p?.refreshMarginMs)) ? Number(p.refreshMarginMs) : 5 * 60 * 1000;
  const accountId = p.mailAccountId;
  const organizationId = p.organizationId;
  const accRes = await db.query(
    `SELECT id, organization_id, email, auth_method, provider, encrypted_credentials, token_expires_at
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2
     FOR UPDATE`,
    [accountId, organizationId]
  );
  const acc = accRes.rows[0];
  if (!acc || acc.provider !== "MICROSOFT" || acc.auth_method !== "MICROSOFT_OAUTH") {
    return { refreshed: false, reason: "NOT_MICROSOFT_OAUTH" };
  }
  const cred = decryptJson(acc.encrypted_credentials);
  const expiresAt = cred.oauth_expires_at || acc.token_expires_at;
  if (expiresAt && new Date(expiresAt).getTime() - marginMs > Date.now()) {
    return { refreshed: false, reason: "NOT_DUE" };
  }
  const refreshToken = String(cred.oauth_refresh_token || "").trim();
  if (!refreshToken) {
    await db.query(
      `UPDATE mail_accounts SET lifecycle_state = 'AUTH_REQUIRED', reconnect_required = true, updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [accountId, organizationId]
    );
    throw oauthError("MICROSOFT_REFRESH_TOKEN_MISSING", "Refresh token Microsoft manquant");
  }
  try {
    const tokens = await exchangeRefreshToken({ refreshToken, fetchImpl: p.fetchImpl });
    assertMicrosoftTokenPayload({ ...tokens, refresh_token: tokens.refresh_token || refreshToken }, acc.email);
    const nextExpires = tokens.expires_in ? new Date(Date.now() + Number(tokens.expires_in) * 1000) : null;
    const encrypted = encryptJson({
      ...cred,
      oauth_access_token: tokens.access_token,
      oauth_refresh_token: tokens.refresh_token || refreshToken,
      oauth_expires_at: nextExpires ? nextExpires.toISOString() : null,
      oauth_scopes: MICROSOFT_OAUTH_SCOPES,
    });
    await db.query(
      `UPDATE mail_accounts SET
         encrypted_credentials = $3::jsonb,
         token_expires_at = $4,
         lifecycle_state = 'CONNECTED',
         reconnect_required = false,
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
      [accountId, organizationId, encrypted, nextExpires]
    );
    return { refreshed: true, expiresAt: nextExpires };
  } catch (e) {
    if (e?.code === "MICROSOFT_REFRESH_REVOKED" || e?.code === "MICROSOFT_REFRESH_TOKEN_MISSING") {
      await db.query(
        `UPDATE mail_accounts SET
           lifecycle_state = 'AUTH_REQUIRED',
           reconnect_required = true,
           last_error_code = $3,
           last_error_message = $4,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [accountId, organizationId, e.code, e.message]
      );
    } else {
      await db.query(
        `UPDATE mail_accounts SET
           lifecycle_state = 'DEGRADED',
           last_error_code = $3,
           last_error_message = $4,
           updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [accountId, organizationId, e?.code || "MICROSOFT_REFRESH_FAILED", e instanceof Error ? e.message : String(e)]
      );
    }
    throw e;
  }
}

export const __test = {
  sha256,
  parseJwtPayload,
  assertMicrosoftTokenPayload,
  microsoftOAuthResultRedirect,
  exchangeRefreshToken,
};
