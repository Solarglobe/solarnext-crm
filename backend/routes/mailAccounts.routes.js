/**
 * CP-070 — API comptes mail (test IMAP, CRUD, dossiers).
 */

import express from "express";
import crypto from "crypto";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
  requireMailUseStrict,
  requireMailAccountsManageStrict,
} from "../middleware/mailAccess.middleware.js";
import {
  testImapConnection,
  saveMailAccount,
  syncFoldersFromImap,
  updateMailAccount,
  ImapErrorCodes,
} from "../services/mail/imap.service.js";
import { pool } from "../config/db.js";
import {
  getAccessibleMailAccountIds,
  canReadMailAccount,
  canConfigureMailAccounts,
} from "../services/mailAccess.service.js";
import { decryptJson } from "../services/security/encryption.service.js";
import { resolveImapCredentials, resolveSmtpCredentials } from "../services/mail/mailCredentials.util.js";
import { testSmtpConnection } from "../services/mail/smtp.service.js";
import { isUuid } from "../services/mail/mailPermissions.service.js";
import {
  publicMailAccount,
  deriveMailAccountCapabilities,
  resolveMailAccountLifecycleTransition,
} from "../services/mail/mailAccountState.service.js";
import {
  createMicrosoftOAuthStart,
  consumeMicrosoftOAuthCallback,
  getMicrosoftOAuthPublicConfig,
  microsoftOAuthResultRedirect,
} from "../services/mail/mailMicrosoftOAuth.service.js";
import { requestMailAccountLocalPurge } from "../services/mail/mailAccountDeletion.service.js";
import { heavyUserRateLimiter, publicHeavyRateLimiter, sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();
const OAUTH_COOKIE = "sn_mail_ms_oauth_state";

function cryptoHash(v) {
  return crypto.createHash("sha256").update(String(v || "")).digest("hex");
}

const ACCOUNT_LIST_SELECT = `id, email, display_name, is_shared, is_active, last_sync_at, created_at, user_id,
       last_imap_sync_at, sync_status, last_imap_error_at, last_imap_error_code, last_imap_error_message,
       imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
       lifecycle_state, provider, auth_method, sync_enabled, is_default_send_account, display_color, sort_order,
       connected_at, disconnected_at, removed_at, deletion_requested_at, deleted_at,
       last_successful_sync_at, last_sync_attempt_at, next_sync_attempt_at,
       last_error_code, last_error_message, imap_status, smtp_status, token_expires_at, reconnect_required`;

function imapStatusFromCode(code) {
  if (code === ImapErrorCodes.AUTH_FAILED) return 401;
  if (code === ImapErrorCodes.CONNECTION_TIMEOUT) return 503;
  if (code === ImapErrorCodes.INVALID_CONFIG) return 400;
  if (code === ImapErrorCodes.DUPLICATE_EMAIL) return 409;
  return 400;
}

function handleImapError(res, err, fallbackStatus = 500) {
  const code = err?.code && typeof err.code === "string" ? err.code : ImapErrorCodes.UNKNOWN;
  const status = code === ImapErrorCodes.UNKNOWN ? fallbackStatus : imapStatusFromCode(code);
  return res.status(status).json({
    success: false,
    code,
    message: err?.message || "Erreur IMAP",
  });
}

/** @param {Record<string, unknown>} row */
function connectionUiStatus(row) {
  if (row.sync_status === "ERROR" || row.last_imap_error_at != null) return "error";
  if (row.last_imap_sync_at != null) return "ok";
  return "untested";
}

router.post("/accounts/test", verifyJWT, requireMailUseStrict(), sensitiveUserRateLimiter, async (req, res) => {
  try {
    const {
      imap_host,
      imap_port,
      imap_secure,
      email,
      password,
      imap_user,
      imap_password,
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_user,
      smtp_password,
    } = req.body || {};
    if (!imap_host || imap_port == null || !email || !password) {
      return res.status(400).json({
        success: false,
        code: ImapErrorCodes.INVALID_CONFIG,
        message: "imap_host, imap_port, email et password requis",
      });
    }
    const authUser = imap_user != null && String(imap_user).trim() !== "" ? String(imap_user).trim() : String(email).trim();
    const out = { imap: { ok: false }, smtp: { ok: false, skipped: true } };
    await testImapConnection({
      host: imap_host,
      port: imap_port,
      secure: imap_secure,
      auth: { user: authUser, pass: imap_password || password },
    });
    out.imap = { ok: true };
    if (smtp_host && smtp_port != null) {
      out.smtp.skipped = false;
      await testSmtpConnection({
        smtp_host,
        smtp_port,
        smtp_secure: smtp_secure === true,
        email: smtp_user || email,
        password: smtp_password || password,
      });
      out.smtp = { ok: true, skipped: false };
    }
    return res.json({ success: true, ...out });
  } catch (err) {
    return handleImapError(res, err);
  }
});

router.post("/accounts", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const b = req.body || {};
    const {
      email,
      password,
      display_name,
      is_shared,
      imap_host,
      imap_port,
      imap_secure,
      imap_user,
      imap_password,
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_user,
      smtp_password,
    } = b;

    if (!email || !password || !imap_host || imap_port == null) {
      return res.status(400).json({
        success: false,
        code: ImapErrorCodes.INVALID_CONFIG,
        message: "email, password, imap_host et imap_port requis",
      });
    }

    const result = await saveMailAccount({
      organizationId,
      userId,
      email,
      displayName: display_name ?? null,
      isShared: Boolean(is_shared),
      imap: {
        host: imap_host,
        port: imap_port,
        secure: imap_secure,
        user: imap_user ?? null,
      },
      smtp:
        smtp_host != null || smtp_port != null
          ? { host: smtp_host, port: smtp_port, secure: smtp_secure, user: smtp_user ?? null }
          : null,
      password,
      imapPassword: imap_password,
      smtpPassword: smtp_password,
    });

    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handleImapError(res, err);
  }
});

router.get("/accounts", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;

    const isManager =
      req.user.role === "SUPER_ADMIN" ||
      (await canConfigureMailAccounts({ userId, organizationId }));

    let rows;
    if (isManager) {
      const r = await pool.query(
        `SELECT ${ACCOUNT_LIST_SELECT}
         FROM mail_accounts
         WHERE organization_id = $1
         ORDER BY email ASC`,
        [organizationId]
      );
      rows = r.rows;
    } else {
      const ids = await getAccessibleMailAccountIds({ userId, organizationId });
      if (ids.size === 0) {
        return res.json({ success: true, accounts: [] });
      }
      const r = await pool.query(
        `SELECT ${ACCOUNT_LIST_SELECT}
         FROM mail_accounts
         WHERE organization_id = $1 AND id = ANY($2::uuid[])
         ORDER BY email ASC`,
        [organizationId, [...ids]]
      );
      rows = r.rows;
    }

    const accounts = rows.map((row) => ({
      ...publicMailAccount(row),
      connection_status: connectionUiStatus(row),
    }));

    return res.json({ success: true, accounts });
  } catch (err) {
    console.error("GET /mail/accounts", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/accounts/:id", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) {
      return res.status(400).json({ success: false, code: "INVALID_ID" });
    }

    const r = await pool.query(
      `SELECT ${ACCOUNT_LIST_SELECT}, encrypted_credentials
       FROM mail_accounts
       WHERE id = $1 AND organization_id = $2`,
      [mailAccountId, organizationId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, code: "NOT_FOUND" });
    }
    const row = r.rows[0];
    let cred = {};
    try {
      cred = decryptJson(row.encrypted_credentials) || {};
    } catch {
      cred = {};
    }
    const imapResolved = resolveImapCredentials(row.email, cred);
    const smtpResolved = resolveSmtpCredentials(row.email, cred);

    const { encrypted_credentials: _enc, ...rest } = row;
    return res.json({
      success: true,
      account: {
        ...rest,
        ...publicMailAccount(rest),
        connection_status: connectionUiStatus(row),
        imap_user: imapResolved.user,
        smtp_user: smtpResolved.user,
        has_imap_password: Boolean(imapResolved.password),
        has_smtp_password: Boolean(smtpResolved.password && row.smtp_host),
      },
    });
  } catch (err) {
    console.error("GET /mail/accounts/:id", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/accounts/oauth/microsoft/config", verifyJWT, requireMailAccountsManageStrict(), async (_req, res) => {
  return res.json({ success: true, microsoft: getMicrosoftOAuthPublicConfig() });
});

router.post("/accounts/oauth/microsoft/start", verifyJWT, requireMailAccountsManageStrict(), heavyUserRateLimiter, async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const { requestedEmail = null, mailAccountId = null } = req.body || {};
    if (mailAccountId && !isUuid(mailAccountId)) {
      return res.status(400).json({ success: false, code: "INVALID_ID" });
    }
    const out = await createMicrosoftOAuthStart({
      userId,
      organizationId,
      requestedEmail: requestedEmail ? String(requestedEmail).trim() : null,
      mailAccountId,
    });
    const state = new URL(out.authorizationUrl).searchParams.get("state");
    if (state) {
      res.cookie(OAUTH_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 10 * 60 * 1000,
        path: "/api/mail/accounts/oauth/microsoft",
      });
    }
    return res.json({ success: true, ...out });
  } catch (err) {
    return res.status(err?.code === "MICROSOFT_OAUTH_NOT_CONFIGURED" ? 503 : 400).json({
      success: false,
      code: err?.code || "MICROSOFT_OAUTH_START_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

router.get("/accounts/oauth/microsoft/callback", publicHeavyRateLimiter, async (req, res) => {
  try {
    const cookieState = readCookie(req, OAUTH_COOKIE);
    const out = await consumeMicrosoftOAuthCallback({
      code: req.query.code,
      state: req.query.state,
      cookieStateHash: cookieState ? cryptoHash(cookieState) : null,
    });
    res.clearCookie(OAUTH_COOKIE, { path: "/api/mail/accounts/oauth/microsoft" });
    const redirect = microsoftOAuthResultRedirect(true, { accountId: out.mailAccountId });
    if (redirect) return res.redirect(302, redirect);
    return res.json(out);
  } catch (err) {
    res.clearCookie(OAUTH_COOKIE, { path: "/api/mail/accounts/oauth/microsoft" });
    const redirect = microsoftOAuthResultRedirect(false, { code: err?.code || "MICROSOFT_OAUTH_CALLBACK_FAILED" });
    if (redirect) return res.redirect(302, redirect);
    return res.status(400).json({
      success: false,
      code: err?.code || "MICROSOFT_OAUTH_CALLBACK_FAILED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.patch("/accounts/:id", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) {
      return res.status(400).json({ success: false, code: "INVALID_ID" });
    }

    const b = req.body || {};
    await updateMailAccount({
      organizationId,
      mailAccountId,
      ownerUserId: userId,
      email: b.email,
      display_name: b.display_name,
      is_shared: b.is_shared,
      is_active: b.is_active,
      imap_host: b.imap_host,
      imap_port: b.imap_port,
      imap_secure: b.imap_secure,
      imap_user: b.imap_user,
      imap_password: b.imap_password,
      smtp_host: b.smtp_host,
      smtp_port: b.smtp_port,
      smtp_secure: b.smtp_secure,
      smtp_user: b.smtp_user,
      smtp_password: b.smtp_password,
    });

    return res.json({ success: true, id: mailAccountId });
  } catch (err) {
    if (err?.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, code: "NOT_FOUND" });
    }
    return handleImapError(res, err);
  }
});

router.delete("/accounts/:id", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) {
      return res.status(400).json({ success: false, code: "INVALID_ID" });
    }

    const r = await pool.query(
      `UPDATE mail_accounts SET
         lifecycle_state = 'REMOVED',
         is_active = false,
         sync_enabled = false,
         is_default_send_account = false,
         removed_at = COALESCE(removed_at, now()),
         updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND COALESCE(lifecycle_state::text, '') <> 'DELETED'
       RETURNING id`,
      [mailAccountId, organizationId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, code: "NOT_FOUND" });
    }
    return res.json({ success: true, removed: true });
  } catch (err) {
    console.error("DELETE /mail/accounts/:id", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.post("/accounts/:id/lifecycle", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  const client = await pool.connect();
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) {
      return res.status(400).json({ success: false, code: "INVALID_ID" });
    }
    const action = String(req.body?.action || "").trim();
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT lifecycle_state FROM mail_accounts WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [mailAccountId, organizationId]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "NOT_FOUND" });
    }
    const next = resolveMailAccountLifecycleTransition(current.rows[0].lifecycle_state, action);
    if (!next.ok) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, code: next.code });
    }
    const r = await client.query(
      `UPDATE mail_accounts SET
         lifecycle_state = $3::mail_account_lifecycle_state,
         is_active = $4,
         sync_enabled = $5,
         reconnect_required = COALESCE($6, reconnect_required),
         disconnected_at = CASE WHEN $7 = 'now' THEN now() WHEN $7 = 'null' THEN NULL ELSE disconnected_at END,
         removed_at = CASE WHEN $8 = 'now' THEN now() ELSE removed_at END,
         is_default_send_account = CASE WHEN $9 = false THEN false ELSE is_default_send_account END,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2
         AND COALESCE(lifecycle_state::text, '') NOT IN ('DELETION_PENDING', 'DELETED')
       RETURNING ${ACCOUNT_LIST_SELECT}`,
      [
        mailAccountId,
        organizationId,
        next.lifecycle_state,
        next.is_active,
        next.sync_enabled,
        next.reconnect_required ?? null,
        next.disconnected_at === "now" ? "now" : next.disconnected_at === null ? "null" : null,
        next.removed_at === "now" ? "now" : null,
        next.is_default_send_account,
      ]
    );
    if (!r.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, code: "NOT_FOUND_OR_LOCKED_STATE" });
    }
    await client.query("COMMIT");
    return res.json({ success: true, account: publicMailAccount(r.rows[0]) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /mail/accounts/:id/lifecycle", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  } finally {
    client.release();
  }
});

router.post("/accounts/:id/default-send", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) return res.status(400).json({ success: false, code: "INVALID_ID" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const acc = await client.query(
        `SELECT id, is_active, lifecycle_state, sync_enabled FROM mail_accounts WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [mailAccountId, organizationId]
      );
      if (!acc.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, code: "NOT_FOUND" });
      }
      if (!deriveMailAccountCapabilities(acc.rows[0]).canSend) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, code: "MAIL_ACCOUNT_CANNOT_SEND" });
      }
      await client.query(`UPDATE mail_accounts SET is_default_send_account = false WHERE organization_id = $1`, [organizationId]);
      await client.query(`UPDATE mail_accounts SET is_default_send_account = true, updated_at = now() WHERE id = $1`, [mailAccountId]);
      await client.query("COMMIT");
      return res.json({ success: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /mail/accounts/:id/default-send", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.post("/accounts/:id/purge-local", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) return res.status(400).json({ success: false, code: "INVALID_ID" });
    const out = await requestMailAccountLocalPurge({
      organizationId,
      mailAccountId,
      userId,
      confirmationEmail: req.body?.confirmationEmail,
    });
    return res.status(202).json(out);
  } catch (err) {
    const code = err?.code || "MAIL_PURGE_FAILED";
    const status = code === "NOT_FOUND" ? 404 : code === "MAIL_PURGE_CONFIRMATION_MISMATCH" ? 409 : 500;
    return res.status(status).json({ success: false, code, message: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/accounts/:id/test", verifyJWT, requireMailAccountsManageStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    if (!isUuid(mailAccountId)) {
      return res.status(400).json({ success: false, code: "INVALID_ID" });
    }

    const r = await pool.query(
      `SELECT email, imap_host, imap_port, imap_secure,
              smtp_host, smtp_port, smtp_secure, encrypted_credentials
       FROM mail_accounts
       WHERE id = $1 AND organization_id = $2`,
      [mailAccountId, organizationId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, code: "NOT_FOUND" });
    }
    const acc = r.rows[0];
    let cred = {};
    try {
      cred = decryptJson(acc.encrypted_credentials) || {};
    } catch {
      cred = {};
    }

    const imapC = resolveImapCredentials(acc.email, cred);
    const out = { imap: { ok: false }, smtp: { ok: false, skipped: true } };

    try {
      await testImapConnection({
        host: acc.imap_host,
        port: acc.imap_port,
        secure: acc.imap_secure !== false,
        auth: { user: imapC.user, pass: imapC.password, accessToken: imapC.accessToken },
      });
      out.imap = { ok: true };
    } catch (e) {
      out.imap = { ok: false, code: e?.code || ImapErrorCodes.UNKNOWN, message: e?.message || String(e) };
    }

    if (acc.smtp_host && acc.smtp_port != null) {
      out.smtp.skipped = false;
      const smtpC = resolveSmtpCredentials(acc.email, cred);
      if (!smtpC.password && !smtpC.accessToken) {
        out.smtp = { ok: false, skipped: false, message: "Credential SMTP manquant" };
      } else {
        try {
          await testSmtpConnection({
            smtp_host: acc.smtp_host,
            smtp_port: acc.smtp_port,
            smtp_secure: acc.smtp_secure === true,
            email: smtpC.user,
            password: smtpC.password,
            accessToken: smtpC.accessToken,
          });
          out.smtp = { ok: true, skipped: false };
        } catch (e) {
          out.smtp = {
            ok: false,
            skipped: false,
            code: e?.code || "SMTP_FAILED",
            message: e?.message || String(e),
          };
        }
      }
    }

    return res.json({ success: true, ...out });
  } catch (err) {
    console.error("POST /mail/accounts/:id/test", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

router.get("/accounts/:id/folders", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const mailAccountId = req.params.id;
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";

    const allowed =
      req.user.role === "SUPER_ADMIN" ||
      (await canReadMailAccount({
        userId,
        organizationId,
        mailAccountId,
      }));

    if (!allowed) {
      return res.status(403).json({
        success: false,
        code: "MAIL_ACCOUNT_ACCESS_DENIED",
      });
    }

    if (refresh) {
      try {
        await syncFoldersFromImap({ mailAccountId, organizationId });
      } catch (err) {
        return handleImapError(res, err);
      }
    }

    const r = await pool.query(
      `SELECT id, name, type, external_id, created_at
       FROM mail_folders
       WHERE organization_id = $1 AND mail_account_id = $2
       ORDER BY type ASC, name ASC`,
      [organizationId, mailAccountId]
    );

    return res.json({ success: true, folders: r.rows });
  } catch (err) {
    console.error("GET /mail/accounts/:id/folders", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

export default router;
