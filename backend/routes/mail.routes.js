/**
 * CP-076 — API mail (inbox, fil, envoi, lecture, archive).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { pool } from "../config/db.js";
import { getAccessibleMailAccountIds } from "../services/mailAccess.service.js";
import {
  listMailInbox,
  getMailThreadDetail,
  markMessageReadInTransaction,
  archiveThreadInTransaction,
  getInboxUnreadSummary,
} from "../services/mail/mailApi.service.js";
import { SmtpErrorCodes, mapSmtpError } from "../services/mail/smtp.service.js";
import { enqueueOutboundMail } from "../services/mail/mailOutbox.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();

/**
 * @param {import('express').Request} req
 * @returns {Promise<Set<string>>}
 */
async function resolveAccessibleAccountIds(req) {
  const userId = req.user.userId ?? req.user.id;
  const organizationId = req.user.organizationId ?? req.user.organization_id;
  if (req.user.role === "SUPER_ADMIN") {
    const r = await pool.query(
      `SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    );
    return new Set(r.rows.map((x) => x.id));
  }
  return getAccessibleMailAccountIds({ userId, organizationId });
}

function smtpHttpStatus(code) {
  if (code === SmtpErrorCodes.AUTH_FAILED) return 401;
  if (code === SmtpErrorCodes.SMTP_UNAVAILABLE) return 503;
  if (code === SmtpErrorCodes.INVALID_CONFIG) return 400;
  if (code === SmtpErrorCodes.SEND_FAILED) return 502;
  return 500;
}

function handleSmtpRouteError(res, err) {
  if (err?.code && Object.values(SmtpErrorCodes).includes(err.code)) {
    return res.status(smtpHttpStatus(err.code)).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }
  try {
    mapSmtpError(err);
  } catch (e2) {
    if (e2?.code && Object.values(SmtpErrorCodes).includes(e2.code)) {
      return res.status(smtpHttpStatus(e2.code)).json({
        success: false,
        code: e2.code,
        message: e2.message,
      });
    }
  }
  return res.status(500).json({ success: false, code: "UNKNOWN", message: String(err) });
}

function parseHasOutboundReply(q) {
  const v = typeof q === "string" ? q.trim().toLowerCase() : "";
  if (v === "yes" || v === "true" || v === "1") return true;
  if (v === "no" || v === "false" || v === "0") return false;
  return null;
}

/** @param {unknown} q */
function parseMailbox(q) {
  const v = typeof q === "string" ? q.trim().toLowerCase() : "";
  if (["inbox", "sent", "draft", "trash", "spam"].includes(v)) return v;
  return null;
}

/**
 * GET /inbox — liste des fils (paginée).
 */
router.get("/inbox", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const accessible = await resolveAccessibleAccountIds(req);
    const limit = req.query.limit;
    const offset = req.query.offset;
    const filter = req.query.filter === "unread" ? "unread" : "all";
    const attachmentsFilter = req.query.attachments === "with" ? "with" : "all";
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : null;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim() : null;
    const leadId = typeof req.query.leadId === "string" ? req.query.leadId.trim() : null;
    const tagId = typeof req.query.tagId === "string" ? req.query.tagId.trim() : null;
    const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom.trim() ? req.query.dateFrom.trim() : null;
    const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo.trim() ? req.query.dateTo.trim() : null;
    const hasOutboundReply = parseHasOutboundReply(req.query.hasReply);
    const mailbox = parseMailbox(req.query.mailbox);

    if (accountId && !accessible.has(accountId)) {
      return res.status(403).json({ success: false, code: "MAIL_ACCOUNT_ACCESS_DENIED" });
    }

    const { items, total } = await listMailInbox(pool, {
      organizationId,
      accessibleAccountIds: accessible,
      limit,
      offset,
      filter,
      attachmentsFilter,
      accountId: accountId || null,
      clientId: clientId || null,
      leadId: leadId || null,
      tagId: tagId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      hasOutboundReply,
      searchQuery: null,
      mailbox,
    });

    return res.json({ items, total });
  } catch (err) {
    console.error("GET /mail/inbox", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * GET /search?q= — même payload que /inbox, recherche texte (sujet, corps, expéditeurs).
 */
router.get("/search", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) {
      return res.json({ items: [], total: 0, searchMeta: null });
    }

    const accessible = await resolveAccessibleAccountIds(req);
    const limit = req.query.limit;
    const offset = req.query.offset;
    const filter = req.query.filter === "unread" ? "unread" : "all";
    const attachmentsFilter = req.query.attachments === "with" ? "with" : "all";
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : null;
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId.trim() : null;
    const leadId = typeof req.query.leadId === "string" ? req.query.leadId.trim() : null;
    const tagId = typeof req.query.tagId === "string" ? req.query.tagId.trim() : null;
    const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom.trim() ? req.query.dateFrom.trim() : null;
    const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo.trim() ? req.query.dateTo.trim() : null;
    const hasOutboundReply = parseHasOutboundReply(req.query.hasReply);
    const mailbox = parseMailbox(req.query.mailbox);

    if (accountId && !accessible.has(accountId)) {
      return res.status(403).json({ success: false, code: "MAIL_ACCOUNT_ACCESS_DENIED" });
    }

    const { items, total, searchMeta } = await listMailInbox(pool, {
      organizationId,
      accessibleAccountIds: accessible,
      limit,
      offset,
      filter,
      attachmentsFilter,
      accountId: accountId || null,
      clientId: clientId || null,
      leadId: leadId || null,
      tagId: tagId || null,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      hasOutboundReply,
      searchQuery: q,
      mailbox,
    });

    return res.json({ items, total, searchMeta: searchMeta ?? null });
  } catch (err) {
    console.error("GET /mail/search", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * GET /inbox/unread-summary — badges non lus (total + par compte).
 */
router.get("/inbox/unread-summary", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }
    const accessible = await resolveAccessibleAccountIds(req);
    const mailbox = parseMailbox(req.query.mailbox);
    const summary = await getInboxUnreadSummary(pool, {
      organizationId,
      accessibleAccountIds: accessible,
      mailbox,
    });
    return res.json(summary);
  } catch (err) {
    console.error("GET /mail/inbox/unread-summary", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * GET /threads/:threadId — détail fil + messages.
 */
router.get("/threads/:threadId", verifyJWT, requireMailUseStrict(), async (req, res) => {
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const { threadId } = req.params;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const accessible = await resolveAccessibleAccountIds(req);
    const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";

    const detail = await getMailThreadDetail(pool, {
      organizationId,
      threadId,
      accessibleAccountIds: accessible,
      includeArchived,
    });

    if (!detail) {
      return res.status(404).json({ success: false, code: "THREAD_NOT_FOUND" });
    }

    return res.json({
      thread: detail.thread,
      messages: detail.messages,
    });
  } catch (err) {
    console.error("GET /mail/threads/:threadId", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  }
});

/**
 * POST /send — enregistre en file d’attente (pas d’envoi SMTP direct).
 */
router.post("/send", verifyJWT, requireMailUseStrict(), sensitiveUserRateLimiter, async (req, res) => {
  try {
    const userId = req.user.userId ?? req.user.id;
    const organizationId = req.user.organizationId ?? req.user.organization_id;

    const result = await enqueueOutboundMail({
      userId,
      organizationId,
      body: req.body || {},
      isSuperAdmin: req.user.role === "SUPER_ADMIN",
    });

    const subj = req.body?.subject != null ? String(req.body.subject).slice(0, 200) : null;
    void logAuditEvent({
      action: AuditActions.EMAIL_SENT,
      entityType: "email",
      entityId: result.outboxId ?? null,
      organizationId,
      userId,
      targetLabel: subj ?? undefined,
      req,
      statusCode: 201,
      metadata: {
        thread_id: result.threadId ?? undefined,
        outbox_id: result.outboxId ?? undefined,
      },
    });

    return res.status(201).json({
      success: true,
      messageId: result.messageId ?? null,
      threadId: result.threadId ?? null,
      outboxId: result.outboxId,
      status: result.status,
      queued: true,
    });
  } catch (err) {
    if (err?.code === "MAIL_SEND_DENIED") {
      return res.status(403).json({
        success: false,
        code: "MAIL_SEND_DENIED",
        message: err.message,
      });
    }
    return handleSmtpRouteError(res, err);
  }
});

/**
 * PATCH /messages/:messageId/read
 */
router.patch("/messages/:messageId/read", verifyJWT, requireMailUseStrict(), async (req, res) => {
  const client = await pool.connect();
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const { messageId } = req.params;
    const rawRead = req.body?.isRead;
    const isRead = !(rawRead === false || rawRead === "false");

    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const accessible = await resolveAccessibleAccountIds(req);

    await client.query("BEGIN");
    const r = await markMessageReadInTransaction(client, {
      organizationId,
      messageId,
      isRead,
      accessibleAccountIds: accessible,
    });
    if (!r.ok) {
      await client.query("ROLLBACK");
      const code = r.code === "MESSAGE_NOT_FOUND" ? 404 : 403;
      return res.status(code).json({ success: false, code: r.code });
    }
    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    console.error("PATCH /mail/messages/:messageId/read", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  } finally {
    client.release();
  }
});

/**
 * DELETE /threads/:threadId — archivage logique (archived_at).
 */
router.delete("/threads/:threadId", verifyJWT, requireMailUseStrict(), async (req, res) => {
  const client = await pool.connect();
  try {
    const organizationId = req.user.organizationId ?? req.user.organization_id;
    const { threadId } = req.params;
    if (!organizationId) {
      return res.status(400).json({ success: false, code: "ORG_REQUIRED" });
    }

    const accessible = await resolveAccessibleAccountIds(req);

    await client.query("BEGIN");
    const r = await archiveThreadInTransaction(client, {
      organizationId,
      threadId,
      accessibleAccountIds: accessible,
    });
    if (!r.ok) {
      await client.query("ROLLBACK");
      const code = r.code === "THREAD_NOT_FOUND" ? 404 : 403;
      return res.status(code).json({ success: false, code: r.code });
    }
    await client.query("COMMIT");
    return res.json({ success: true, archived: true });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    console.error("DELETE /mail/threads/:threadId", err);
    return res.status(500).json({ success: false, code: "SERVER_ERROR" });
  } finally {
    client.release();
  }
});

export default router;
