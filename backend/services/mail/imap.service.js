/**
 * CP-070 — Connecteur IMAP générique (ImapFlow). Aucun SDK provider (Gmail API, Graph, etc.).
 */

import { ImapFlow } from "imapflow";
import { pool } from "../../config/db.js";
import { encryptJson, decryptJson } from "../security/encryption.service.js";
import { discoverImapFoldersWithStatus } from "./mailFolderDiscovery.service.js";
import { resolveImapCredentials, resolveSmtpCredentials } from "./mailCredentials.util.js";
import { assertSafeMailEndpoint, createSafeMailLookup } from "./mailNetworkGuard.service.js";
import { testSmtpConnection } from "./smtp.service.js";
import { assertMailAccountCapability } from "./mailAccountState.service.js";

export const ImapErrorCodes = {
  AUTH_FAILED: "AUTH_FAILED",
  CONNECTION_TIMEOUT: "CONNECTION_TIMEOUT",
  INVALID_CONFIG: "INVALID_CONFIG",
  UNKNOWN: "UNKNOWN",
  DUPLICATE_EMAIL: "DUPLICATE_EMAIL",
  SYNC_FAILED: "SYNC_FAILED",
};

function throwImapError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  throw err;
}

/**
 * @param {unknown} err
 * @returns {never}
 */
export function mapImapError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const low = msg.toLowerCase();

  if (
    low.includes("auth") ||
    low.includes("invalid credentials") ||
    low.includes("authentication failed") ||
    low.includes("login failed") ||
    low.includes("no permission")
  ) {
    throwImapError(ImapErrorCodes.AUTH_FAILED, msg, err);
  }
  if (
    low.includes("timeout") ||
    low.includes("timed out") ||
    low.includes("etimedout") ||
    low.includes("econnrefused") ||
    low.includes("enotfound") ||
    low.includes("getaddrinfo")
  ) {
    throwImapError(ImapErrorCodes.CONNECTION_TIMEOUT, msg, err);
  }
  if (low.includes("invalid") && (low.includes("host") || low.includes("port"))) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, msg, err);
  }

  throwImapError(ImapErrorCodes.UNKNOWN, msg, err);
}

/**
 * @typedef {object} ImapAuthConfig
 * @property {string} host
 * @property {number} port
 * @property {boolean} [secure]
 * @property {{ user: string, password?: string, pass?: string, accessToken?: string }} auth
 * @property {number} [connectionTimeoutMs]
 */

/**
 * @param {ImapAuthConfig} config
 */
export function buildImapFlowOptions(config) {
  if (!config?.host || typeof config.host !== "string") {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "host requis");
  }
  const port = Number(config.port);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "port invalide");
  }
  const user = config.auth?.user ?? config.auth?.username;
  const pass = config.auth?.password ?? config.auth?.pass;
  const accessToken = config.auth?.accessToken;
  if (!user || (!pass && !accessToken)) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "auth.user et credential requis");
  }

  return {
    host: config.host.trim(),
    port,
    secure: config.secure !== false,
    auth: accessToken
      ? { user: String(user), accessToken: String(accessToken) }
      : { user: String(user), pass: String(pass) },
    logger: false,
    connectionTimeout: config.connectionTimeoutMs ?? 25_000,
    lookup: createSafeMailLookup(),
  };
}

/**
 * @param {ImapAuthConfig} config
 * @returns {Promise<ImapFlow>}
 */
export async function createImapClient(config) {
  const opts = buildImapFlowOptions(config);
  await assertSafeMailEndpoint({ host: opts.host, port: opts.port, protocol: "imap" });
  const client = new ImapFlow(opts);
  try {
    await client.connect();
    return client;
  } catch (e) {
    try {
      await client.logout();
    } catch {
      // ignore
    }
    mapImapError(e);
  }
}

/**
 * @param {ImapAuthConfig} config
 * @returns {Promise<{ success: true }>}
 */
export async function testImapConnection(config) {
  const client = await createImapClient(config);
  try {
    await client.mailboxOpen("INBOX");
    return { success: true };
  } catch (e) {
    if (e?.code && Object.values(ImapErrorCodes).includes(e.code)) {
      throw e;
    }
    mapImapError(e);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

/**
 * @param {ImapAuthConfig} config
 * @returns {Promise<Array<{ name: string, type: string, path: string, external_id: string }>>}
 */
export async function getMailboxes(config) {
  const client = await createImapClient(config);
  try {
    const discovered = await discoverImapFoldersWithStatus(client);
    return discovered.folders;
  } catch (e) {
    if (e?.code && Object.values(ImapErrorCodes).includes(e.code)) {
      throw e;
    }
    mapImapError(e);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

/**
 * @param {import('pg').PoolClient} db
 * @param {{ organizationId: string, mailAccountId: string, folders: Array<Record<string, unknown>> }} p
 */
export async function persistDiscoveredMailFolders(db, p) {
  const { organizationId, mailAccountId, folders } = p;
  const seenPaths = [];

  for (const box of folders) {
    const path = String(box.external_id || box.path || "").trim();
    if (!path) continue;
    seenPaths.push(path);

    const attributesJson = JSON.stringify(Array.isArray(box.attributes) ? box.attributes : []);
    const status =
      box.selectable === false
        ? "NOSELECT"
        : box.statusError
          ? "ERROR"
          : "DISCOVERED";

    await db.query(
      `INSERT INTO mail_folders (
         organization_id, mail_account_id, name, type, external_id,
         parent_path, delimiter, depth, attributes_json, special_use,
         selectable, subscribed, is_active, last_discovered_at,
         uid_validity, highest_modseq, remote_message_count, remote_unread_count,
         message_sync_status, history_sync_status, sync_priority,
         last_message_sync_error_at, last_message_sync_error_code, last_message_sync_error_message,
         updated_at
       ) VALUES (
         $1, $2, $3, $4::mail_folder_type, $5,
         $6, $7, $8, $9::jsonb, $10,
         $11, $12, true, now(),
         $13, $14, $15, $16,
         $17, 'PARTIAL', $18,
         CASE WHEN $19::text IS NULL THEN NULL ELSE now() END, CASE WHEN $19::text IS NULL THEN NULL ELSE 'STATUS_FAILED' END, $19,
         now()
       )
       ON CONFLICT (mail_account_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         parent_path = EXCLUDED.parent_path,
         delimiter = EXCLUDED.delimiter,
         depth = EXCLUDED.depth,
         attributes_json = EXCLUDED.attributes_json,
         special_use = EXCLUDED.special_use,
         selectable = EXCLUDED.selectable,
         subscribed = EXCLUDED.subscribed,
         is_active = true,
         last_discovered_at = now(),
         uid_validity = COALESCE(EXCLUDED.uid_validity, mail_folders.uid_validity),
         highest_modseq = COALESCE(EXCLUDED.highest_modseq, mail_folders.highest_modseq),
         remote_message_count = EXCLUDED.remote_message_count,
         remote_unread_count = EXCLUDED.remote_unread_count,
         message_sync_status = CASE
           WHEN EXCLUDED.selectable = false THEN 'NOSELECT'
           WHEN EXCLUDED.last_message_sync_error_message IS NOT NULL THEN 'ERROR'
           WHEN mail_folders.message_sync_status = 'NEVER_SYNCED' THEN 'DISCOVERED'
           ELSE mail_folders.message_sync_status
         END,
         history_sync_status = 'PARTIAL',
         sync_priority = EXCLUDED.sync_priority,
         last_message_sync_error_at = EXCLUDED.last_message_sync_error_at,
         last_message_sync_error_code = EXCLUDED.last_message_sync_error_code,
         last_message_sync_error_message = EXCLUDED.last_message_sync_error_message,
         updated_at = now()`,
      [
        organizationId,
        mailAccountId,
        box.name,
        box.type || "CUSTOM",
        path,
        box.parent_path ?? null,
        box.delimiter ?? null,
        Number.isFinite(Number(box.depth)) ? Number(box.depth) : 0,
        attributesJson,
        box.special_use ?? null,
        box.selectable !== false,
        typeof box.subscribed === "boolean" ? box.subscribed : null,
        box.uidValidity ?? null,
        box.highestModseq ?? null,
        Number.isFinite(Number(box.remoteMessageCount)) ? Number(box.remoteMessageCount) : null,
        Number.isFinite(Number(box.remoteUnreadCount)) ? Number(box.remoteUnreadCount) : null,
        status,
        Number.isFinite(Number(box.sync_priority)) ? Number(box.sync_priority) : 50,
        box.statusError ?? null,
      ]
    );
  }

  if (seenPaths.length > 0) {
    await db.query(
      `UPDATE mail_folders SET
         is_active = false,
         message_sync_status = 'INACTIVE',
         updated_at = now()
       WHERE organization_id = $1
         AND mail_account_id = $2
         AND is_active = true
         AND NOT (external_id = ANY($3::text[]))`,
      [organizationId, mailAccountId, seenPaths]
    );
  }

  await db.query(
    `UPDATE mail_folders child
     SET parent_id = parent.id,
         updated_at = now()
     FROM mail_folders parent
     WHERE child.organization_id = $1
       AND child.mail_account_id = $2
       AND child.parent_path IS NOT NULL
       AND parent.organization_id = child.organization_id
       AND parent.mail_account_id = child.mail_account_id
       AND parent.external_id = child.parent_path`,
    [organizationId, mailAccountId]
  );

  return { upserted: seenPaths.length };
}

/**
 * @param {{ mailAccountId: string, organizationId: string }} p
 */
export async function syncFoldersFromImap(p) {
  const { mailAccountId, organizationId } = p;
  const row = await pool.query(
    `SELECT email, imap_host, imap_port, imap_secure, encrypted_credentials,
            is_active, lifecycle_state, sync_enabled, reconnect_required
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2`,
    [mailAccountId, organizationId]
  );
  if (row.rows.length === 0) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "Compte mail introuvable");
  }
  const acc = row.rows[0];
  assertMailAccountCapability(acc, "canSync");
  const cred = decryptJson(acc.encrypted_credentials);
  const { user: imapUser, password, accessToken } = resolveImapCredentials(acc.email, cred);
  if (!password && !accessToken) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "Credentials invalides");
  }

  const cfg = {
    host: acc.imap_host,
    port: acc.imap_port,
    secure: acc.imap_secure !== false,
    auth: { user: imapUser, password, accessToken },
  };

  const client = await createImapClient(cfg);
  const db = await pool.connect();
  try {
    const discovered = await discoverImapFoldersWithStatus(client);
    await persistDiscoveredMailFolders(db, {
      organizationId,
      mailAccountId,
      folders: discovered.folders,
    });
    return { synced: discovered.folders.length, statusChecked: discovered.statusChecked };
  } finally {
    db.release();
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   email: string,
 *   displayName?: string | null,
 *   isShared?: boolean,
 *   imap: { host: string, port: number, secure?: boolean, user?: string | null },
 *   smtp?: { host?: string, port?: number, secure?: boolean, user?: string | null } | null,
 *   password: string,
 *   imapPassword?: string,
 *   smtpPassword?: string | null,
 * }} input
 */
export async function saveMailAccount(input) {
  const {
    organizationId,
    userId,
    email,
    displayName = null,
    isShared = false,
    imap,
    smtp = null,
    password,
    imapPassword: imapPasswordOpt,
    smtpPassword: smtpPasswordOpt,
  } = input;

  const emailTrim = String(email).trim();
  const imapPassword = imapPasswordOpt != null && String(imapPasswordOpt) !== "" ? String(imapPasswordOpt) : password;
  const smtpPassword =
    smtpPasswordOpt != null && String(smtpPasswordOpt) !== ""
      ? String(smtpPasswordOpt)
      : smtp?.host
        ? password
        : null;

  if (!organizationId || !userId || !emailTrim || !imapPassword) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "organizationId, userId, email et mot de passe IMAP requis");
  }
  if (!imap?.host || imap.port == null) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "imap.host et imap.port requis");
  }

  const credDraft = {
    imap_user: imap.user != null ? String(imap.user).trim() : null,
    imap_password: imapPassword,
    smtp_user: smtp?.user != null ? String(smtp.user).trim() : null,
    smtp_password: smtpPassword,
    password: imapPassword,
  };
  const { user: imapAuthUser, password: imapAuthPass } = resolveImapCredentials(emailTrim, credDraft);

  const cfg = {
    host: imap.host,
    port: Number(imap.port),
    secure: imap.secure !== false,
    auth: { user: imapAuthUser, pass: imapAuthPass },
  };

  await testImapConnection(cfg);
  if (smtp?.host && smtp.port != null) {
    const { user: smtpAuthUser, password: smtpAuthPass } = resolveSmtpCredentials(emailTrim, credDraft);
    await testSmtpConnection({
      smtp_host: smtp.host,
      smtp_port: Number(smtp.port),
      smtp_secure: smtp.secure === true,
      email: smtpAuthUser,
      password: smtpAuthPass,
    });
  }
  const folders = await getMailboxes(cfg);

  const encrypted = encryptJson({
    v: 1,
    password: imapPassword,
    imap_user: credDraft.imap_user || null,
    imap_password: imapPassword,
    smtp_user: credDraft.smtp_user || null,
    smtp_password: smtpPassword,
  });

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    let ins;
    try {
      ins = await dbClient.query(
        `INSERT INTO mail_accounts (
          organization_id, user_id, email, display_name,
          imap_host, imap_port, imap_secure,
          smtp_host, smtp_port, smtp_secure,
          encrypted_credentials, is_shared, is_active, lifecycle_state, sync_enabled, provider, auth_method, connected_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10,
          $11::jsonb, $12, true, 'CONNECTED', true, 'IMAP_SMTP', 'PASSWORD', now()
        )
        RETURNING id`,
        [
          organizationId,
          isShared ? null : userId,
          emailTrim,
          displayName,
          imap.host,
          Number(imap.port),
          imap.secure !== false,
          smtp?.host ?? null,
          smtp?.port != null ? Number(smtp.port) : null,
          smtp?.secure ?? null,
          encrypted,
          isShared,
        ]
      );
    } catch (e) {
      if (e.code === "23505") {
        throwImapError(
          ImapErrorCodes.DUPLICATE_EMAIL,
          "Un compte avec cet email existe déjà pour cette organisation"
        );
      }
      throw e;
    }

    const mailAccountId = ins.rows[0].id;

    await persistDiscoveredMailFolders(dbClient, {
      organizationId,
      mailAccountId,
      folders,
    });

    await dbClient.query("COMMIT");
    return { id: mailAccountId, folderCount: folders.length };
  } catch (e) {
    await dbClient.query("ROLLBACK");
    throw e;
  } finally {
    dbClient.release();
  }
}

/**
 * @param {{
 *   organizationId: string,
 *   mailAccountId: string,
 *   email?: string,
 *   display_name?: string | null,
 *   is_shared?: boolean,
 *   is_active?: boolean,
 *   imap_host?: string,
 *   imap_port?: number,
 *   imap_secure?: boolean,
 *   imap_user?: string | null,
 *   imap_password?: string | null,
 *   smtp_host?: string | null,
 *   smtp_port?: number | null,
 *   smtp_secure?: boolean | null,
 *   smtp_user?: string | null,
 *   smtp_password?: string | null,
 *   ownerUserId?: string | null,
 * }} patch
 */
export async function updateMailAccount(patch) {
  const { organizationId, mailAccountId } = patch;
  const ownerUserId = patch.ownerUserId ?? null;
  const r0 = await pool.query(
    `SELECT id, email, display_name, is_shared, is_active,
            imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure,
            encrypted_credentials, lifecycle_state, provider, auth_method
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2`,
    [mailAccountId, organizationId]
  );
  if (r0.rows.length === 0) {
    const err = new Error("NOT_FOUND");
    err.code = "NOT_FOUND";
    throw err;
  }
  const row = r0.rows[0];
  let cred = {};
  try {
    cred = decryptJson(row.encrypted_credentials) || {};
  } catch {
    cred = {};
  }

  const nextEmail = patch.email != null ? String(patch.email).trim() : row.email;
  const nextDisplay = patch.display_name !== undefined ? patch.display_name : row.display_name;
  const nextShared = patch.is_shared !== undefined ? Boolean(patch.is_shared) : row.is_shared;
  const nextActive = patch.is_active !== undefined ? Boolean(patch.is_active) : row.is_active;
  const nextImapHost = patch.imap_host !== undefined ? patch.imap_host : row.imap_host;
  const nextImapPort = patch.imap_port !== undefined ? Number(patch.imap_port) : row.imap_port;
  const nextImapSecure = patch.imap_secure !== undefined ? patch.imap_secure !== false : row.imap_secure !== false;

  const imapUser =
    patch.imap_user !== undefined
      ? patch.imap_user == null
        ? null
        : String(patch.imap_user).trim()
      : cred.imap_user != null
        ? String(cred.imap_user).trim()
        : null;

  const imapPassword =
    patch.imap_password !== undefined && String(patch.imap_password).trim() !== ""
      ? String(patch.imap_password)
      : String(cred.imap_password ?? cred.password ?? "");

  const smtpUser =
    patch.smtp_user !== undefined
      ? patch.smtp_user == null
        ? null
        : String(patch.smtp_user).trim()
      : cred.smtp_user != null
        ? String(cred.smtp_user).trim()
        : null;

  const smtpPassword =
    patch.smtp_password !== undefined && String(patch.smtp_password).trim() !== ""
      ? String(patch.smtp_password)
      : cred.smtp_password != null
        ? String(cred.smtp_password)
        : cred.password != null
          ? String(cred.password)
          : "";

  const nextSmtpHost =
    patch.smtp_host !== undefined
      ? patch.smtp_host != null && String(patch.smtp_host).trim() !== ""
        ? String(patch.smtp_host).trim()
        : null
      : row.smtp_host;
  const nextSmtpPort = patch.smtp_port !== undefined ? (patch.smtp_port == null ? null : Number(patch.smtp_port)) : row.smtp_port;
  const nextSmtpSecure =
    patch.smtp_secure !== undefined ? (patch.smtp_secure === true ? true : patch.smtp_secure === false ? false : null) : row.smtp_secure;

  const credMerged = {
    v: 1,
    password: imapPassword,
    imap_user: imapUser || null,
    imap_password: imapPassword,
    smtp_user: smtpUser || null,
    smtp_password: nextSmtpHost ? smtpPassword : null,
  };

  const { user: imapAuthUser, password: imapAuthPass } = resolveImapCredentials(nextEmail, credMerged);
  if (!imapAuthPass) {
    throwImapError(ImapErrorCodes.INVALID_CONFIG, "Mot de passe IMAP manquant");
  }

  const testCfg = {
    host: nextImapHost,
    port: nextImapPort,
    secure: nextImapSecure,
    auth: { user: imapAuthUser, pass: imapAuthPass },
  };
  await testImapConnection(testCfg);
  if (nextSmtpHost && nextSmtpPort != null) {
    const smtpResolved = resolveSmtpCredentials(nextEmail, credMerged);
    await testSmtpConnection({
      smtp_host: nextSmtpHost,
      smtp_port: nextSmtpPort,
      smtp_secure: nextSmtpSecure === true,
      email: smtpResolved.user,
      password: smtpResolved.password,
      accessToken: smtpResolved.accessToken,
    });
  }

  const encrypted = encryptJson(credMerged);

  try {
    const up = await pool.query(
      `UPDATE mail_accounts SET
         email = $3,
         display_name = $4,
         is_shared = $5,
         is_active = $6,
         imap_host = $7,
         imap_port = $8,
         imap_secure = $9,
         smtp_host = $10,
         smtp_port = $11,
         smtp_secure = $12,
         encrypted_credentials = $13::jsonb,
         lifecycle_state = CASE WHEN $6 = true THEN 'CONNECTED'::mail_account_lifecycle_state ELSE 'DISABLED'::mail_account_lifecycle_state END,
         sync_enabled = $6,
         reconnect_required = false,
         connected_at = CASE WHEN $6 = true THEN COALESCE(connected_at, now()) ELSE connected_at END,
         disconnected_at = CASE WHEN $6 = false THEN now() ELSE NULL END,
         user_id = CASE
           WHEN $5 = true THEN NULL
           WHEN $5 = false AND user_id IS NULL AND $14 IS NOT NULL THEN $14::uuid
           ELSE user_id
         END,
         updated_at = now()
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [
        mailAccountId,
        organizationId,
        nextEmail,
        nextDisplay,
        nextShared,
        nextActive,
        nextImapHost,
        nextImapPort,
        nextImapSecure,
        nextSmtpHost,
        nextSmtpPort,
        nextSmtpSecure,
        encrypted,
        ownerUserId,
      ]
    );
    if (up.rows.length === 0) {
      const err = new Error("NOT_FOUND");
      err.code = "NOT_FOUND";
      throw err;
    }
    return { id: mailAccountId };
  } catch (e) {
    if (e.code === "23505") {
      throwImapError(ImapErrorCodes.DUPLICATE_EMAIL, "Un compte avec cet email existe déjà pour cette organisation");
    }
    throw e;
  }
}

/**
 * @param {{ organizationId: string, mailAccountId: string }} p
 */
export async function deleteMailAccountByOrg(p) {
  const { organizationId, mailAccountId } = p;
  const r = await pool.query(`DELETE FROM mail_accounts WHERE id = $1 AND organization_id = $2 RETURNING id`, [
    mailAccountId,
    organizationId,
  ]);
  return { deleted: r.rowCount > 0 };
}
