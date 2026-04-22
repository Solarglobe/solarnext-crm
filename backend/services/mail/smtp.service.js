/**
 * CP-071 — Connecteur SMTP générique (Nodemailer), sans API fournisseur.
 */

import nodemailer from "nodemailer";
import fs from "fs/promises";
import path from "path";
import { pool } from "../../config/db.js";
import { decryptJson } from "../security/encryption.service.js";
import { resolveSmtpCredentials } from "./mailCredentials.util.js";
import {
  persistOutboundInTransaction,
  getSentFolderId,
  buildAttachmentRows,
} from "./mailSendPersistence.service.js";
import {
  applyTrackingToHtml,
  generateTrackingId,
  isMailTrackingEnabled,
} from "./mailTracking.service.js";
import { emitEventAsync } from "../core/eventBus.service.js";

export const SmtpErrorCodes = {
  INVALID_CONFIG: "INVALID_CONFIG",
  AUTH_FAILED: "AUTH_FAILED",
  SMTP_UNAVAILABLE: "SMTP_UNAVAILABLE",
  SEND_FAILED: "SEND_FAILED",
};

function throwSmtp(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  throw err;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function inferSmtpFailureCode(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const low = msg.toLowerCase();
  const c = err?.code;
  if (c === "EAUTH" || low.includes("invalid login") || low.includes("authentication failed")) {
    return SmtpErrorCodes.AUTH_FAILED;
  }
  if (
    c === "ETIMEDOUT" ||
    c === "ECONNREFUSED" ||
    c === "ENOTFOUND" ||
    c === "ECONNRESET" ||
    low.includes("timeout") ||
    low.includes("econnrefused") ||
    low.includes("getaddrinfo") ||
    low.includes("self signed") ||
    low.includes("certificate")
  ) {
    return SmtpErrorCodes.SMTP_UNAVAILABLE;
  }
  return SmtpErrorCodes.SEND_FAILED;
}

/**
 * @param {unknown} err
 * @returns {never}
 */
export function mapSmtpError(err) {
  if (err?.code && Object.values(SmtpErrorCodes).includes(err.code)) {
    throw err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  throwSmtp(inferSmtpFailureCode(err), msg, err);
}

/**
 * @param {{
 *   host?: string,
 *   smtp_host?: string,
 *   port?: number,
 *   smtp_port?: number,
 *   secure?: boolean,
 *   smtp_secure?: boolean,
 *   email?: string,
 *   password?: string,
 *   auth?: { user?: string, password?: string },
 * }} config
 */
export function createSmtpTransport(config) {
  const host = config.smtp_host ?? config.host;
  const port = config.smtp_port ?? config.port;
  const secure = config.smtp_secure ?? config.secure;
  const user = config.email ?? config.auth?.user;
  const pass = config.password ?? config.auth?.password;

  if (!host || port == null || !user || !pass) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "smtp_host, smtp_port, email et password requis");
  }

  const p = Number(port);
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "smtp_port invalide");
  }

  return nodemailer.createTransport({
    host: String(host).trim(),
    port: p,
    secure: secure === true,
    auth: { user: String(user).trim(), pass: String(pass) },
    connectionTimeout: 25_000,
  });
}

/**
 * @param {Parameters<typeof createSmtpTransport>[0]} config
 * @returns {Promise<{ success: true }>}
 */
export async function testSmtpConnection(config) {
  let transport;
  try {
    transport = createSmtpTransport(config);
    await transport.verify();
    return { success: true };
  } catch (e) {
    if (e?.code && Object.values(SmtpErrorCodes).includes(e.code)) {
      throw e;
    }
    mapSmtpError(e);
  } finally {
    if (transport && typeof transport.close === "function") {
      transport.close();
    }
  }
}

/**
 * @param {Array<{ filename?: string, content?: Buffer|string, path?: string, contentType?: string, contentBase64?: string }>} attachments
 */
async function toNodemailerAttachments(attachments) {
  if (!attachments?.length) return [];
  const out = [];
  for (const a of attachments) {
    let content;
    if (a.contentBase64 != null && String(a.contentBase64).trim() !== "") {
      content = Buffer.from(String(a.contentBase64).replace(/\s/g, ""), "base64");
    } else if (a.content != null) {
      content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content), "utf8");
    } else if (a.path) {
      content = await fs.readFile(path.resolve(a.path));
    } else {
      continue;
    }
    out.push({
      filename: a.filename || path.basename(a.path || "attachment"),
      content,
      contentType: a.contentType,
    });
  }
  return out;
}

/**
 * @param {string | string[] | undefined} v
 * @returns {string[]}
 */
export function parseAddressList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v
      .flatMap((x) => String(x).split(/[,;]/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(v)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {{
 *   mailAccountId: string,
 *   organizationId: string,
 *   actorUserId: string,
 *   fromName?: string | null,
 *   to: string | string[],
 *   cc?: string | string[],
 *   bcc?: string | string[],
 *   subject?: string,
 *   bodyText?: string | null,
 *   bodyHtml?: string | null,
 *   replyTo?: string | null,
 *   inReplyTo?: string | null,
 *   references?: string[] | null,
 *   attachments?: Array<{ filename?: string, content?: Buffer|string, path?: string, contentType?: string }>,
 * }} params
 */
/**
 * Charge un compte mail actif et les credentials SMTP (pour worker / file d’attente).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ organizationId: string, mailAccountId: string }} p
 */
export async function loadActiveMailAccountWithSmtpCredentials(db, p) {
  const { organizationId, mailAccountId } = p;
  const accRes = await db.query(
    `SELECT id, organization_id, email, display_name, is_active,
            smtp_host, smtp_port, smtp_secure, encrypted_credentials
     FROM mail_accounts
     WHERE id = $1 AND organization_id = $2`,
    [mailAccountId, organizationId]
  );

  if (accRes.rows.length === 0) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "Compte mail introuvable pour cette organisation");
  }

  const acc = accRes.rows[0];
  if (!acc.is_active) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "Compte mail inactif");
  }
  if (!acc.smtp_host || acc.smtp_port == null) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "Configuration SMTP incomplète (smtp_host / smtp_port)");
  }

  let password;
  let smtpUser;
  try {
    const cred = decryptJson(acc.encrypted_credentials);
    const resolved = resolveSmtpCredentials(acc.email, cred);
    smtpUser = resolved.user;
    password = resolved.password;
  } catch {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "Impossible de déchiffrer les credentials du compte");
  }
  if (!password) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "Mot de passe SMTP manquant dans les credentials");
  }

  return { acc, password, smtpUser };
}

/**
 * Envoie un message préparé (sans persistance CRM) — utilisé par le worker outbox.
 * @param {{
 *   acc: Record<string, unknown>,
 *   password: string,
 *   fromHeader: string,
 *   to: string[],
 *   cc?: string[],
 *   bcc?: string[],
 *   subject: string,
 *   bodyText?: string | null,
 *   bodyHtml?: string | null,
 *   replyTo?: string | null,
 *   inReplyTo?: string | null,
 *   references?: string[] | null,
 *   nodemailerAttachments?: import('nodemailer').SendMailOptions['attachments'],
 * }} opts
 */
export async function sendMailNodemailerOnly(opts) {
  const {
    acc,
    password,
    smtpAuthUser,
    fromHeader,
    to,
    cc = [],
    bcc = [],
    subject,
    bodyText,
    bodyHtml,
    replyTo,
    inReplyTo,
    references,
    nodemailerAttachments,
  } = opts;

  const transport = createSmtpTransport({
    smtp_host: acc.smtp_host,
    smtp_port: acc.smtp_port,
    smtp_secure: acc.smtp_secure === true,
    email: smtpAuthUser ?? acc.email,
    password,
  });

  const mailOpts = {
    from: fromHeader,
    to: to.join(", "),
    cc: cc.length ? cc.join(", ") : undefined,
    bcc: bcc.length ? bcc.join(", ") : undefined,
    subject: subject?.trim() || "(sans objet)",
    text: bodyText || undefined,
    html: bodyHtml || undefined,
    replyTo: replyTo || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references?.length ? references.join(" ") : undefined,
    attachments: nodemailerAttachments?.length ? nodemailerAttachments : undefined,
  };

  try {
    const info = await transport.sendMail(mailOpts);
    return { info, mailOpts };
  } finally {
    transport.close();
  }
}

export async function sendMailViaSmtp(params) {
  const {
    mailAccountId,
    organizationId,
    actorUserId,
    fromName,
    to: toRaw,
    cc: ccRaw,
    bcc: bccRaw,
    subject,
    bodyText,
    bodyHtml,
    replyTo,
    inReplyTo,
    references,
    attachments,
  } = params;

  const to = parseAddressList(toRaw);
  const cc = parseAddressList(ccRaw);
  const bcc = parseAddressList(bccRaw);

  if (!to.length) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "Au moins un destinataire (to) est requis");
  }
  if (!bodyText?.trim() && !bodyHtml?.trim()) {
    throwSmtp(SmtpErrorCodes.INVALID_CONFIG, "bodyText ou bodyHtml requis");
  }

  const { acc, password, smtpUser } = await loadActiveMailAccountWithSmtpCredentials(pool, {
    organizationId,
    mailAccountId,
  });

  const transport = createSmtpTransport({
    smtp_host: acc.smtp_host,
    smtp_port: acc.smtp_port,
    smtp_secure: acc.smtp_secure === true,
    email: smtpUser,
    password,
  });

  const nodemailerAtt = await toNodemailerAttachments(attachments);
  const attachmentRows = await buildAttachmentRows(attachments);

  let bodyHtmlForSend = bodyHtml;
  let trackingId = null;
  if (bodyHtml?.trim() && isMailTrackingEnabled()) {
    trackingId = generateTrackingId();
    bodyHtmlForSend = applyTrackingToHtml(bodyHtml, trackingId);
  }

  const fromHeader =
    fromName?.trim() ? `"${fromName.trim().replace(/"/g, "")}" <${acc.email}>` : acc.email;

  const mailOpts = {
    from: fromHeader,
    to: to.join(", "),
    subject: subject?.trim() || "(sans objet)",
    text: bodyText || undefined,
    html: bodyHtmlForSend || undefined,
    replyTo: replyTo || undefined,
    inReplyTo: inReplyTo || undefined,
    references: references?.length ? references.join(" ") : undefined,
    attachments: nodemailerAtt.length ? nodemailerAtt : undefined,
  };

  let info;
  try {
    info = await transport.sendMail(mailOpts);
  } catch (e) {
    try {
      await persistFailureSafe({
        organizationId,
        mailAccountId,
        accountEmail: acc.email,
        accountDisplayName: acc.display_name,
        fromName,
        subject: mailOpts.subject,
        bodyText,
        bodyHtml,
        to,
        cc,
        bcc,
        inReplyTo,
        referencesIds: references || null,
        attachmentRows,
        trackingId: null,
        err: e,
      });
    } catch (pe) {
      console.error("[smtp] persistance FAILED après erreur SMTP:", pe);
    }
    mapSmtpError(e);
  } finally {
    transport.close();
  }

  const smtpMessageId = info.messageId ? String(info.messageId).trim() : null;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const folderId = await getSentFolderId(db, { organizationId, mailAccountId });
    const persisted = await persistOutboundInTransaction(db, {
      organizationId,
      mailAccountId,
      accountEmail: acc.email,
      accountDisplayName: acc.display_name,
      fromName,
      subject: mailOpts.subject,
      bodyText,
      bodyHtml: bodyHtmlForSend,
      to,
      cc,
      bcc,
      replyTo,
      inReplyTo,
      referencesIds: references || null,
      smtpMessageId,
      status: "SENT",
      sentAt: new Date(),
      folderId,
      failureCode: null,
      failureReason: null,
      providerResponse:
        typeof info.response === "string" ? info.response.slice(0, 8000) : JSON.stringify(info.response ?? "").slice(0, 8000),
      hasAttachments: attachmentRows.length > 0,
      attachmentRows,
      trackingId,
    });
    await db.query("COMMIT");

    emitEventAsync("MAIL_SENT", {
      messageId: persisted.messageId,
      threadId: persisted.threadId,
      organizationId,
      userId: actorUserId,
      mailAccountId,
    });

    return {
      success: true,
      messageId: smtpMessageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
      persisted,
    };
  } catch (e) {
    await db.query("ROLLBACK");
    console.error("[smtp] persistance SENT en échec après envoi OK:", e);
    throwSmtp(SmtpErrorCodes.SEND_FAILED, "Envoi SMTP OK mais échec persistance CRM", e);
  } finally {
    db.release();
  }
}

async function persistFailureSafe(ctx) {
  const {
    organizationId,
    mailAccountId,
    accountEmail,
    accountDisplayName,
    fromName,
    subject,
    bodyText,
    bodyHtml,
    to,
    cc,
    bcc,
    inReplyTo,
    referencesIds,
    attachmentRows,
    trackingId = null,
    err,
  } = ctx;

  const code = inferSmtpFailureCode(err);

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await persistOutboundInTransaction(db, {
      organizationId,
      mailAccountId,
      accountEmail,
      accountDisplayName,
      fromName,
      subject,
      bodyText,
      bodyHtml,
      to,
      cc,
      bcc,
      replyTo: null,
      inReplyTo,
      referencesIds,
      smtpMessageId: null,
      status: "FAILED",
      sentAt: null,
      folderId: null,
      failureCode: code,
      failureReason: err instanceof Error ? err.message : String(err),
      providerResponse: String(err?.response ?? err?.stack ?? "").slice(0, 8000),
      hasAttachments: attachmentRows.length > 0,
      attachmentRows,
      trackingId,
    });
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
